
const {FactomCli} = require('factom');
const {Entry} = require('factom/src/entry');

//set up simple key:value cache to track entryhash existence and status. used for all types of stores
//map of entryhash : status
const entryHashCache = new Map();

//ids of chains that the cache is tracking tracking.
const trackedChainIds = new Set();

//a hybrid disk + memory cache for holding chains, map of ChainID : array of all entries in the chain
const cache = require('flat-cache');
const chainCache = cache.load('chaincache');

//on startup enumerate all entry hashes from the cached chains
var allChains = chainCache.all();

for (var key in allChains) {
    if (allChains.hasOwnProperty(key)) {
        allChains[key].forEach(function (entry) {
            entryHashCache.set(entry._id, 'DBlockConfirmed');
        });
    }
}

// console.log(entryHashCache.size + ' entries were already cached');

//you must have a wallet running locally on port 8089 for this to work!
var cli = new FactomCli();

var pendingEntryLoop;

var pendingEntryInterval = 5000;

function FactomdCache(params) {

    if (params) {
        //factomd client params passthrough
        if (params.factomdParams) {
            cli = new FactomCli(params.factomdParams);
        }

        if (params.pendingEntryInterval) {
            if (isNaN(params.pendingEntryInterval)) throw new Error('pendingEntryInterval must be a number');
            if (params.pendingEntryInterval < 1) throw new Error('pendingEntryInterval must be >= 1');
            pendingEntryInterval = params.pendingEntryInterval;
        }
    }

    var chainSyncCallbacks = new Set();
    var pendingEntryCallbacks = new Set();

    //expose some event listeners
    this.on = function (event, chainId, callback) {
        switch (event) {
            case 'new-entries': {
                callback.chainId = chainId;
                pendingEntryCallbacks.add(callback);
                break;
            }

            default: {

            }
        }
    };

    //cache a chain by it's ID.
    async function cacheChain(chainId, callback, progressCallback) {

        //check if the chain is already cached

        var cachedChain = chainCache.getKey(chainId);

        //if the chain hasn't been cached yet, get it in it's entirety from the API
        if (!cachedChain) {
            //get every entry of the chain so we can store it in our local DB
            let entries = await cli.getAllEntriesOfChain(chainId);

            //convert the fields and buffers of the entry to strings and construct simple object from the result. Crude normalization
            let index = 0;
            let cachedEntries = entries.map(function (entry) {
                entry = {
                    _id: entry.hashHex(), //why...
                    chainId: entry.chainId,
                    hash: entry.hashHex(),
                    content: entry.content,
                    extIds: entry.extIds,
                    timestamp: entry.timestamp,
                    blockContext: entry.blockContext,
                    status: 'DBlockConfirmed', //mark this entry as confirmed
                    index: index //this entry's index within the chain so it can be reconstructed later
                };
                // console.log(entry.timestamp);
                // console.log(entry.blockContext);

                entryHashCache.set(entry._id, entry.status);
                index++;
                return entry;
            });

            //insert in memory, overwriting previous chain entries
            // console.log('CACHING TOCACHE:')
            // console.log(cachedEntries[0]);
            chainCache.setKey(chainId, cachedEntries); //store all entries in the map
            chainCache.save(); //save changes

            //mark the chain tracked
            trackedChainIds.add(chainId);

            //attempt to init the pending loop
            initPendingEntryLoop();

            if (callback) callback(undefined, entries);
            return entries;
        }

        //transform the cache entries into factom.js datastructures
        let finalChain = cachedChain.map(entry =>
            Entry.builder()
                .chainId(chainId, 'hex')
                .extIds(entry.extIds, 'utf8')
                .content(entry.content, 'utf8')
                .timestamp(entry.timestamp)
                .entryBlockContext(entry.blockContext)
                .build()
        );

        //if the chain has been synced, just return what we have now. This handles duplicate calls
        if (trackedChainIds.has(chainId)) {
            return finalChain;
        }

        //get entry with context for last cached entry
        let entry = await cli.getEntryWithBlockContext(cachedChain[cachedChain.length - 1].hash);

        if (!entry) { //the most recent entries are pending, meaning the most recent entry is on the current dblock(height)
            //mark the chain tracked
            trackedChainIds.add(chainId);
            initPendingEntryLoop();
            return finalChain;
        }

        //get current dblock height
        let heights = await cli.factomdApi('heights', {});

        var lastHeight = entry.blockContext.directoryBlockHeight;

        // console.log(heights);
        var currentHeight = heights.directoryblockheight;
        var blockHeights = [];

        while (lastHeight <= currentHeight) {
            blockHeights.push(lastHeight);
            lastHeight++;
        }

        // console.log('BLOCKHEIGHTS: ' + JSON.stringify(blockHeights));

        let dblocks = await getDBlocksFromFactomdAPI(blockHeights);

        // console.log('DBLOCKS LENGTH: ' + dblocks.length);

        let eBlockKeyMRS = [];

        //pull out the keymrs of the entry blocks that belong to this chain
        dblocks.forEach(dblock =>
            dblock.dblock.dbentries.forEach(dbentry => {
                if (dbentry.chainid == chainId) eBlockKeyMRS.push(dbentry.keymr)
            }));


        // console.log('EBLOCKKMR LENGTH: ' + eBlockKeyMRS.length);

        //query all eblocks by keymr
        let eblocks = await getEBlocksFromFactomdAPI(eBlockKeyMRS);

        // console.log('EBLOCK LENGTH: ' + eblocks.length);

        var entryHashes = [];
        eblocks.forEach(function (eblock) {
            eblock.entrylist.forEach(entry => {
                if (!entryHashCache.has(entry.entryhash)) entryHashes.push(entry.entryhash)
            });
        });

        if (entryHashes.length == 0) {
            //mark the chain tracked
            trackedChainIds.add(chainId);
            initPendingEntryLoop();
            return finalChain;
        }

        //query all entries by hash
        let entries = await getEntriesWithContextFromFactomdAPI(entryHashes);
        // console.log(entries);

        finalChain = finalChain.concat(entries);

        //insert new entries into cached chain and callback!
        let index = cachedChain[cachedChain.length - 1].index + 1;
        entries = entries.map(entry => {
            entry = {
                _id: entry.hashHex(), //why...
                chainId: entry.chainId,
                hash: entry.hash(),
                content: entry.content,
                extIds: entry.extIds,
                timestamp: entry.timestamp,
                blockContext: entry.blockContext,
                status: 'DBlockConfirmed', //mark this entry as confirmed
                index: index //this entry's index within the chain so it can be reconstructed later
            };
            index++;
            return entry;
            }
        );

        // console.log(entries);

        cachedChain = cachedChain.concat(entries);
        chainCache.setKey(chainId, cachedChain);
        chainCache.save();

        //mark the chain tracked
        trackedChainIds.add(chainId);

        initPendingEntryLoop();

        if (callback) callback(undefined, cachedChain);

        return finalChain;
    }

    this.cacheChain = cacheChain;


    function isChainCached(chainId) {
        return chainCache.getKey(chainId) !== undefined;
    }

    this.isChainCached = isChainCached;

    //poll for and cache pending entries for the chains we're tracking
    async function cachePendingEntries(callback) {
        let pendingEntries = await cli.factomdApi('pending-entries', {});
        // console.log(pendingEntries);
        if (pendingEntries.length == 0) {
            //No pending entries were found!
            // console.log("No new entries found");
            if (callback) callback(undefined, []);
            return;
        }

        // console.log(pendingEntries);

        //only handle entries with hashes we have not already processed
        pendingEntries = pendingEntries.filter(pendingEntry => !entryHashCache.has(pendingEntry.entryhash) && trackedChainIds.has(pendingEntry.chainid));

        if (pendingEntries.length == 0) {
            // console.log("No new entries found");

            if (callback) callback(undefined, []);
            return;
        }

        // console.log('Found ' + pendingEntries.length + ' New Entries to cache! ');

        //get all the pending entries from Factom by hash, preserving order
        let rawEntries = await getEntries(pendingEntries.map(entry => entry.entryhash));

        var chainEntries = {};

        //sort the pending entries by chain ID
        rawEntries.forEach(rawEntry => {

            let finalEntry = {
                _id: rawEntry.hash().toString('hex'), //why...
                chainId: rawEntry.chainId,
                hash: rawEntry.hash().toString('hex'),
                content: rawEntry.content,
                extIds: rawEntry.extIds,
                timestamp: new Date().getTime(),
                blockContext: { //mock block context
                    directoryBlockHeight: 7042,
                    entryBlockTimestamp: new Date().getTime() / 1000,
                    entryBlockSequenceNumber: 1,
                    entryBlockKeyMR: 'a13ac9df4153903f5a07093effe6434bdeb35fea0ff4bd402f323e486bea6ea4'
                },
                status: 'TransactionAck', //mark this entry as confirmed
                // index: index //this entry's index within the chain so it can be reconstructed later
            };

            //initialize or append, here we are making a big assumption that the API returns pending entries in chrono order
            if (!chainEntries[rawEntry.chainIdHex]) chainEntries[rawEntry.chainIdHex] = [finalEntry];
            else chainEntries[rawEntry.chainIdHex].push(finalEntry);
        });

        //for each of the chains with new entries, we need to get the latest known index of an entry in the
        // DB from the importing process and set it for the pending entry
        for (var chainId in chainEntries) {
            if (!chainEntries.hasOwnProperty(chainId)) continue;

            let index = await getLatestChainEntryIndex(chainId);

            if (index > -1) index++; //if there are entries in this chain already then start from the last known one + 1
            else index = 0; //otherwise start from scratch

            //mark every entry with it's index in the chain
            chainEntries[chainId] = chainEntries[chainId].map(entry => {
                entry.index = index;
                index++;
                return entry;
            });

            var cachedChain = chainCache.getKey(chainId);
            if (cachedChain) {
                chainCache.setKey(chainId, cachedChain.concat(chainEntries[chainId]));
                chainCache.save();

                //prepare final entries
                chainEntries[chainId] = chainEntries[chainId].map(entry => {
                    entryHashCache.set(entry._id, entry.status);
                    return Entry.builder()
                        .chainId(chainId, 'utf8')
                        .extIds(entry.extIds, 'utf8')
                        .content(entry.content, 'utf8')
                        .timestamp(entry.timestamp)
                        .entryBlockContext(entry.blockContext)
                        .build();
                });

                //call callback for new entries
                pendingEntryCallbacks.forEach(cb => cb(chainEntries[chainId]));
            }
        }


    }

    async function getLatestChainEntryIndex(chainId) {

        var cachedChain = chainCache.getKey(chainId);
        if (cachedChain) {
            return cachedChain.length > 0 ? cachedChain[cachedChain.length - 1].index : -1;
        } else {
            await cacheChain();
            return await getLatestChainEntryIndex(chainId);
        }
    }

    async function getLatestChainEntry(chainId) {

        var cachedEntries = chainCache.getKey(chainId);
        if (cachedEntries) {
            let entry = cachedEntries[cachedEntries.length - 1];
            return Entry.builder()
                .chainId(chainId, 'utf8')
                .extIds(entry.extIds, 'utf8')
                .content(entry.content, 'utf8')
                .timestamp(entry.timestamp)
                .entryBlockContext(entry.blockContext)
                .build();
        } else {
            await cacheChain(chainId);

            return await getLatestChainEntry(chainId);
        }
    }

    this.getLatestChainEntry = getLatestChainEntry;

    async function getEntries(hashes) {
        return await Promise.all(hashes.map(hash => cli.getEntry(hash)));
    }

    async function getEntriesWithContextFromFactomdAPI(hashes) {
        return await Promise.all(hashes.map(hash => cli.getEntryWithBlockContext(hash)));
    }

    async function getDBlocksFromFactomdAPI(heights) {
        return await Promise.all(heights.map(height => cli.factomdApi('dblock-by-height', {height: height})));
    }

    async function getEBlocksFromFactomdAPI(keyMRs) {
        return Promise.all(keyMRs.map(mr => cli.factomdApi('entry-block', {keymr: mr})));
    }

    async function getAllChainEntries(chainId, callback) {
        let cachedEntries = chainCache.getKey(chainId);
        if (cachedEntries) {
            return cachedEntries.map(entry =>
                Entry.builder()
                    .chainId(chainId, 'utf8')
                    .extIds(entry.extIds, 'utf8')
                    .content(entry.content, 'utf8')
                    .timestamp(entry.timestamp)
                    .entryBlockContext(entry.blockContext)
                    .build());
        } else {
            return await cacheChain(chainId, callback);
        }
    }

    this.getAllChainEntries = getAllChainEntries;

    async function getRangedChainEntries(chainId, startIndexInclusive, endIndexExclusive) {
        var cachedEntries = chainCache.getKey(chainId);
        if (cachedEntries) {
            //transform into entries
            return cachedEntries.slice(startIndexInclusive, endIndexExclusive).map(entry =>
                Entry.builder()
                    .chainId(chainId, 'utf8')
                    .extIds(entry.extIds, 'utf8')
                    .content(entry.content, 'utf8')
                    .timestamp(entry.timestamp)
                    .entryBlockContext(entry.blockContext)
                    .build());
        } else {
            await cacheChain(chainId);
            return await getRangedChainEntries(chainId, startIndexInclusive, endIndexExclusive);
        }
    }

    this.getRangedChainEntries = getRangedChainEntries;

    async function getLatestChainEntries(chainId, count) {
        if (!count) count = 25;

        if (isNaN(count)) throw new Error('count must be a number');

        var cachedEntries = chainCache.getKey(chainId);
        if (cachedEntries) {
            cachedEntries = (cachedEntries.length - count <= 0) ? cachedEntries : cachedEntries.slice(cachedEntries.length - count, cachedEntries.length);
            return cachedEntries.map(entry =>
                Entry.builder()
                    .chainId(chainId, 'utf8')
                    .extIds(entry.extIds, 'utf8')
                    .content(entry.content, 'utf8')
                    .timestamp(entry.timestamp)
                    .entryBlockContext(entry.blockContext)
                    .build());
        } else {
            await cacheChain(chainId);
            return await getLatestChainEntries(chainId, count);
        }
    }

    this.getLatestChainEntries = getLatestChainEntries;

    //util functions

    function initPendingEntryLoop() {
        if (!pendingEntryLoop) {

            pendingEntryLoop = setInterval(() => {
                cachePendingEntries()
            }, pendingEntryInterval);
            cachePendingEntries();
        }
    }

    //remove a chain from the cache
    function clearChain(chainId) {

        trackedChainIds.delete(chainId);
        var cachedChain = chainCache.getKey(chainId);

        if (cachedChain) {
            //clear all entries from the hash cache
            cachedChain.forEach(entry => entryHashCache.delete(entry.hash));
        }

        chainCache.removeKey(chainId);
        chainCache.save();

        //remove pending entry callbacks
        pendingEntryCallbacks = new Set(Array.from(pendingEntryCallbacks).filter(callback => callback.chainId === chainId));
    }

    this.clearChain = clearChain;

    this.close = function () {
        clearInterval(pendingEntryLoop)
    };

    return this;
}

module.exports = {
    FactomdCache: FactomdCache
};
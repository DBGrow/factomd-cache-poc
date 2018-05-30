const u = require('./u');

const {FactomCli} = require('factom');

//set up simple key:value cache to track entryhash existence and status. used for all types of stores
//map of entryhash : status
const entryHashCache = new Map();

//ids of chains that the cache is tracking tracking.
const trackedChainIds = new Set();

//a hybrid disk + memory cache for holding chains, map of ChainID : array of all entries
const chainCache = require('flat-cache').load('chaincache');

//you must have a wallet running locally on port 8089 for this to work!
var cli = new FactomCli();

var pendingEntryLoop;

function FactomdCache(params) {

    if (params) {
        //factomd client params passthrough
        if (params.factomdparams) {
            cli = new FactomCli(params.factomdparams);
        }
    }

    function cacheChain(chainId, callback) {
        console.log('Caching Chain ' + chainId + '...\n');

        //get every entry of the chain so we can store it in our local DB
        console.time("Get All Entries");
        cli.getAllEntriesOfChain(chainId).then(function (entries) {
            console.timeEnd("Get All Entries");

            //convert the fields and buffers of the entry to strings and construct simple object from the result. Crude normalization
            let index = 0;
            entries = entries.map(function (entry) {
                entry = {
                    _id: entry.hashHex(), //why...
                    chainId: chainId,
                    hash: entry.hashHex(),
                    content: entry.contentHex,
                    extIds: entry.extIdsHex,
                    timestamp: entry.timestamp,
                    status: 'DBlockConfirmed', //mark this entry as confirmed
                    index: index //this entry's index within the chain so it can be reconstructed later
                };
                index++;
                return entry;
            });


            //insert in memory, overwriting previous chain entries
            chainCache.setKey(chainId, entries); //store all entries in the map
            chainCache.save(); //save changes

            //mark the entries cached
            entries.forEach(function (entry) {
                entryHashCache.set(entry._id, entry.status)
            });

            //mark the chain tracked
            trackedChainIds.add(chainId);

            //attempt to init the pending loop
            initPendingEntryLoop();

            if (callback) callback(undefined, entries);

        }).catch(function (err) {
            if (callback) callback(err);
            else console.error(err);
        });
    }

    this.cacheChain = cacheChain;


    //poll for and cache pending entries for the chains we're tracking
    function cachePendingEntries() {
        cli.factomdApi('pending-entries', {}).then(function (pendingEntries) {
            if (pendingEntries.length == 0) {
                //No pending entries were found!
                return;
            }

            //only handle entries with hashes we have not already processed
            const preFilterCount = pendingEntries.length;
            pendingEntries = pendingEntries.filter(function (pendingEntry) {
                return !entryHashCache.has(pendingEntry.entryhash) && trackedChainIds.has(pendingEntry.chainid);
            });


            if (pendingEntries.length == 0) return; //ignore

            // console.log(preFilterCount - pendingEntries.length + ' pending entries were already cached or were not on a tracked chain.');
            console.log('Found ' + pendingEntries.length + ' New Entries to cache!');

            //get all the pending entries from Factom by hash, preserving order
            getEntriesFromFactomdAPI(pendingEntries.map(function (entry) {
                return entry.entryhash
            }), function (err, rawEntries) {
                if (err) {
                    console.error(err);
                    return;
                }

                var chainEntries = {};

                //sort the pending entries by chain ID
                rawEntries.forEach(function (rawEntry) {
                    const mongoEntry = {
                        _id: rawEntry.hashHex(), //oh my god why is this one inconsistent with the others?
                        content: rawEntry.contentHex,
                        extIds: rawEntry.extIdsHex,
                        status: 'TransactionACK'
                    };

                    //initialize or append, here we are making a big assumption that the API returns pending entries in chrono order
                    if (!chainEntries[rawEntry.chainIdHex]) chainEntries[rawEntry.chainIdHex] = [mongoEntry];
                    else chainEntries[rawEntry.chainIdHex].push(mongoEntry);
                });

                //for each of the chains with new entries, we need to get the latest known index of an entry in the
                // DB from the importing process and set it for the pending entry
                for (var chainId in chainEntries) {
                    if (!chainEntries.hasOwnProperty(chainId)) continue;


                    getLatestChainEntryIndex(chainId, function (err, index) {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        if (index > -1) index++; //if there are entries in this chain already then start from the last known one + 1
                        else index = 0; //otherwise start from scratch

                        //mark every entry with it's index in the chain
                        chainEntries[chainId] = chainEntries[chainId].map(function (entry) {
                            entry.index = index;
                            index++;
                            return entry;
                        });

                        var cachedChain = chainCache.getKey(chainId);
                        if (cachedChain) {
                            chainCache.setKey(chainId, cachedChain.concat(chainEntries[chainId]));
                            chainCache.save();
                            chainEntries[chainId].forEach(function (entry) {
                                entryHashCache.set(entry._id, entry.status)
                            });
                        }
                        //otherwise just ignore
                    });
                }
            });
        }).catch(console.error);
    }

    function getLatestChainEntryIndex(chainId, callback) {

        var cachedChain = chainCache.getKey(chainId);
        if (cachedChain) {
            if (callback) callback(undefined, cachedChain.length > 0 ? cachedChain[cachedChain.length - 1].index : -1);
        } else {
            cacheChain(chainId, function (err) {
                if (err) {
                    if (callback) callback(err);
                    else console.error(err);
                    return;
                }

                getLatestChainEntryIndex(chainId, callback);
            });
        }
    }

    this.getLatestChainEntryIndex = getLatestChainEntryIndex;

    function getLatestChainEntry(chainId, callback) {

        var cachedEntries = chainCache.getKey(chainId);
        if (cachedEntries) {
            if (callback) callback(undefined, cachedEntries[cachedEntries.length - 1]);
        } else {
            cacheChain(chainId, function (err, cachedEntries) {
                if (err) {
                    if (callback) callback(err);
                    else console.error(err);
                    return;
                }

                getLatestChainEntry(chainId, callback);
            });
        }
    }

    this.getLatestChainEntry = getLatestChainEntry;

    function getEntriesFromFactomdAPI(hashes, callback) {
        var tasks = [];
        hashes.forEach(function (hash) {
            tasks.push(cli.getEntry(hash))
        });

        u.processArray(tasks, function (item) {
            return item;
        }).then(function (result) {
            if (callback) callback(undefined, result);
        }, function (err) {
            console.error(err);
            if (callback) callback(err);
        })
    }

    function getAllChainEntries(chainId, callback) {

        var cachedEntries = chainCache.getKey(chainId);
        if (cachedEntries) {
            if (callback) callback(undefined, cachedEntries);
        } else {
            cacheChain(chainId, callback);
        }
    }

    this.getAllChainEntries = getAllChainEntries;

    function getRangedChainEntries(chainId, startIndexInclusive, endIndexExclusive, callback) {

        var cachedEntries = chainCache.getKey(chainId);
        if (cachedEntries) {
            if (callback) callback(undefined, cachedEntries.slice(startIndexInclusive, endIndexExclusive))
        } else {
            cacheChain(chainId, function (err) {
                if (err) {
                    if (callback) callback(err);
                    else console.error(err);
                    return;
                }
                getRangedChainEntries(chainId, startIndexInclusive, endIndexExclusive, callback);
            });
        }
    }

    this.getRangedChainEntries = getRangedChainEntries;

    function getLatestChainEntries(chainId, count, callback) {

        if (!count) count = 25;
        if (isNaN(count)) {
            if (callback) callback(new Error("count must be a number, not type " + typeof count + ' (' + count + ')'));
            return;
        }


        var cachedEntries = chainCache.getKey(chainId);
        if (cachedEntries) {
            if (callback) callback(undefined, (cachedEntries.length - count <= 0) ? cachedEntries : cachedEntries.slice(cachedEntries.length - count, cachedEntries.length));
        } else {
            cacheChain(chainId, function (err, cachedEntries) {
                if (err) {
                    if (callback) callback(err);
                    else console.error(err);
                    return;
                }
                getLatestChainEntries(chainId, count, callback);
            });
        }
    }

    this.getLatestChainEntries = getLatestChainEntries;

    //util functions

    function initPendingEntryLoop() {
        if (!pendingEntryLoop) {
            pendingEntryLoop = setInterval(function () {
                cachePendingEntries();
            }, 10000);
            cachePendingEntries();
        }
    }

    return this;
}


module.exports = {
    FactomdCache: FactomdCache
};
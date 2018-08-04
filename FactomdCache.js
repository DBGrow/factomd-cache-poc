const u = require('./u');

const {FactomCli} = require('factom');

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
    function cacheChain(chainId, callback, progressCallback) {

        //check if the chain is already cached

        var cachedChain = chainCache.getKey(chainId);
        if (cachedChain) {
            // console.log("chain was already in cache");

            //if the chain has been synced, just return what we have now. This handles duplicate calls
            if (trackedChainIds.has(chainId)) {
                if (callback) callback(undefined, cachedChain);
                return;
            }

            // console.log(cachedChain);
            console.log(Buffer.from(cachedChain[cachedChain.length - 1].hash).toString('hex'));
            //get entry with context for last cached entry

            cli.getEntryWithBlockContext(Buffer.from(cachedChain[cachedChain.length - 1].hash).toString('hex')).then(function (entry) {


                //entry is undefined if entry is pending?
                if (!entry) {
                    //the most recent entries are pending
                    console.log('Chain ' + chainId + ' is up to date! (all new entries were pending)');

                    //mark the chain tracked
                    trackedChainIds.add(chainId);
                    initPendingEntryLoop();

                    if (callback) callback(undefined, cachedChain);
                    return;
                }

                //get current dblock height
                cli.factomdApi('heights', {}).then(function (heights) {

                    var lastHeight = entry.blockContext.directoryBlockHeight;

                    // console.log(heights);
                    var currentHeight = heights.directoryblockheight;
                    var blockHeights = [];

                    while (lastHeight <= currentHeight) {
                        blockHeights.push(lastHeight);
                        lastHeight++;
                    }

                    getDBlocksFromFactomdAPI(blockHeights, function (err, dblocks) {
                        // console.log(JSON.stringify(dblocks, undefined, 2));

                        var eBlockKeyMRS = [];

                        //pull out the keymrs of the entry blocks that belong to this chain
                        dblocks.forEach(function (dblock) {
                            dblock.dblock.dbentries.forEach(function (dbentry) {
                                if (dbentry.chainid == chainId) eBlockKeyMRS.push(dbentry.keymr);

                            });
                        });

                        // console.log(eBlockKeyMRS);
                        //query all eblocks by keymr
                        getEBlocksFromFactomdAPI(eBlockKeyMRS, function (err, eblocks) {
                            // console.log(eblocks);

                            var entryHashes = [];
                            eblocks.forEach(function (eblock) {
                                eblock.entrylist.forEach(function (entry) {
                                    if (!entryHashCache.has(entry.entryhash)) entryHashes.push(entry.entryhash)
                                });
                            });


                            if (entryHashes.length == 0) {

                                //mark the chain tracked
                                trackedChainIds.add(chainId);
                                initPendingEntryLoop();


                                if (callback) callback(undefined, cachedChain);
                                return;
                            }

                            //query all entries by hash
                            getEntriesFromFactomdAPI(entryHashes, function (err, entries) {
                                // console.log(entries);

                                //insert new entries into cached chain and callback!
                                let index = cachedChain[cachedChain.length - 1].index + 1;
                                entries = entries.map(function (entry) {
                                    entry = {
                                        _id: entry.hashHex(), //why...
                                        chainId: entry.chainId,
                                        hash: entry.hash(),
                                        content: entry.content,
                                        extIds: entry.extIds,
                                        timestamp: entry.timestamp,
                                        status: 'DBlockConfirmed', //mark this entry as confirmed
                                        index: index //this entry's index within the chain so it can be reconstructed later
                                    };

                                    index++;
                                    return entry;
                                });

                                // console.log(entries);

                                cachedChain = cachedChain.concat(entries);
                                chainCache.setKey(chainId, cachedChain);
                                chainCache.save();

                                //mark the chain tracked
                                trackedChainIds.add(chainId);

                                initPendingEntryLoop();

                                if (callback) callback(undefined, cachedChain);

                            }, function (total, completed, percent) {
                                if (progressCallback) progressCallback({
                                    event: "Syncing New Entries",
                                    total: total,
                                    completed: completed,
                                    percent: percent
                                });
                            });
                        }, function (total, completed, percent) {

                            if (progressCallback) progressCallback({
                                event: "Getting Entry Blocks",
                                total: total,
                                completed: completed,
                                percent: percent
                            });
                        });
                    }, function (total, completed, percent) {
                        if (progressCallback) progressCallback({
                            event: "Getting Directory Blocks",
                            total: total,
                            completed: completed,
                            percent: percent
                        });
                    });

                }).catch(function (err) {
                    if (callback) callback(err);
                });

            }).catch(function (err) {
                if (callback) callback(err);
            });


            return;
        }

        //get every entry of the chain so we can store it in our local DB
        cli.getAllEntriesOfChain(chainId).then(function (entries) {

            //convert the fields and buffers of the entry to strings and construct simple object from the result. Crude normalization
            let index = 0;
            entries = entries.map(function (entry) {
                entry = {
                    _id: entry.hashHex(), //why...
                    chainId: entry.chainId,
                    hash: entry.hash(),
                    content: entry.content,
                    extIds: entry.extIds,
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


    function isChainCached(chainId) {
        return chainCache.has(chainId);
    }

    this.isChainCached = isChainCached;

    //poll for and cache pending entries for the chains we're tracking
    function cachePendingEntries(callback) {
        cli.factomdApi('pending-entries', {}).then(function (pendingEntries) {
            if (pendingEntries.length == 0) {
                //No pending entries were found!
                // console.log("No new entries found");
                if (callback) callback(undefined, []);
                return;
            }

            // console.log(pendingEntries);

            //only handle entries with hashes we have not already processed
            pendingEntries = pendingEntries.filter(function (pendingEntry) {
                return !entryHashCache.has(pendingEntry.entryhash) && trackedChainIds.has(pendingEntry.chainid);
            });


            if (pendingEntries.length == 0) {
                // console.log("No new entries found");

                if (callback) callback(undefined, []);
                return;
            }

            console.log('Found ' + pendingEntries.length + ' New Entries to cache!: ' + pendingEntries.map(function (entry) {
                return entry.entryhash;
            }));

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

                    let finalEntry = {
                        _id: rawEntry.hashHex(), //why...
                        chainId: rawEntry.chainId,
                        hash: rawEntry.hashHex(),
                        content: rawEntry.content,
                        extIds: rawEntry.extIds,
                        timestamp: rawEntry.timestamp,
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


                    getLatestChainEntryIndex(chainId, function (err, index) {
                        if (err) {
                            console.error(err);

                            if (callback) callback(err);
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

                            //call callback for new entries
                            pendingEntryCallbacks.forEach(function (cb) {
                                cb(chainEntries[chainId])
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

    function getEntriesFromFactomdAPI(hashes, callback, progressCallback) {
        var tasks = [];
        hashes.forEach(function (hash) {
            tasks.push(cli.getEntry(hash))
        });

        u.processArray(tasks, function (item) {
            return item;
        }, progressCallback).then(function (result) {
            if (callback) callback(undefined, result);
        }, function (err) {
            console.error(err);
            if (callback) callback(err);
        })
    };

    function getDBlocksFromFactomdAPI(heights, callback, progressCallback) {
        var tasks = [];
        heights.forEach(function (height) {
            tasks.push(cli.factomdApi('dblock-by-height', {height: height}))
        });

        u.processArray(tasks, function (item) {
            return item;
        }, progressCallback).then(function (result) {
            if (callback) callback(undefined, result);
        }, function (err) {
            console.error(err);
            if (callback) callback(err);
        }).catch(function (err) {
            console.error(err);
        });
    };

    function getEBlocksFromFactomdAPI(keyMRs, callback, progressCallback) {
        var tasks = [];
        keyMRs.forEach(function (mr) {
            tasks.push(cli.factomdApi('entry-block', {keymr: mr}))
        });

        u.processArray(tasks, function (item) {
            return item;
        }, progressCallback).then(function (result) {
            if (callback) callback(undefined, result);
        }, function (err) {
            console.error(err);
            if (callback) callback(err);
        })
    };

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

        if (count < 0) {
            if (callback) callback(new Error("count must be > 0"));
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
            cachedChain.forEach(function (entry) {
                entryHashCache.delete(entry.hash);
            });
        }

        chainCache.removeKey(chainId);
        chainCache.save();

        //remove pending entry callbacks
        pendingEntryCallbacks = new Set(Array.from(pendingEntryCallbacks).filter(function (callback) {
            return callback.chainId == chainId;
        }));
    }

    this.clearChain = clearChain;

    //remove all chains from the cache
    function clearChainCache() {
        trackedChainIds.clear();
        entryHashCache.clear();
        pendingEntryCallbacks.clear();
        cache.clearCacheById('chaincache');
    }

    this.clearChainCache = clearChainCache;

    return this;
}

module.exports = {
    FactomdCache: FactomdCache
};
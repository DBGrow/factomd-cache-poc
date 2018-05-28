const crypto = require('crypto');

const u = require('./u');

const {FactomCli} = require('factom');
const {Entry} = require('factom/src/entry');
const {Chain} = require('factom/src/chain');

const MongoClient = require('mongodb').MongoClient;
let client;

let db;

//set up simple key:value cache to track entryhash existence and status. used for all types of stores
//map of entryhash : status
const entryCache = new Map();

//a cache for the memory based chain cache store, map of chainID: array of all chain entries
const chainCache = new Map();

//Testnet credentials, enjoy the 10,000 testnet EC's!
const EC = 'EC1tE4afVGPrBUStDhZPx1aHf4yHqsJuaDpM7WDbXCcYxruUxj2D';
const ES = 'Es3k4L7La1g7CY5zVLer21H3JFkXgCBCBx8eSM2q9hLbevbuoL6a';

//you must have a testnet wallet running locally on port 8089 for this to work!
var cli = new FactomCli({
    factomd: {
        host: '88.200.170.90' //ilzheev (De Facto)#4781 on Discord's testnet courtesy node
    }
});

//config
var store = 'MEMORY'; // MEMORY | MONGODB. Memory by default
var mongouri = 'mongodb://localhost:27017'; //localhost by default

//Testnet test Chain ID:
const testChainID = 'f1be007d4b82e7093f2234efd1beb429bc5e0311e9ae98dcd580616a2046a6b3';

/*const entry = Entry.builder()
    .chainId(testChainID)
    .extId('' + new Date().getTime())
    .content(crypto.randomBytes(100).toString(), 'utf8')
    .build();

var n = new Chain(entry);
cli.addChain(n, ES)
    .then(function (chain) {
        console.log('Created test chain ');
        console.log(chain)
    }).catch(console.error);
return;*/


function FactomdCache(params) {

    if (params) {
        //evaluate storage method
        if (params.store) store = params.store;
        if (!['MEMORY', 'MONGODB'].includes(store)) throw new Error('Invalid store type ' + store);

        //mongodb store params
        if (params.mongouri) mongouri = params.mongouri;

        //memory store params

        //factom client params passthrough
        if (params.factomdparams) {
            cli = new FactomCli(params.factomdparams);
        }
    }


    if (store == 'MONGODB') {

        //Connect to the MongoDB server. This could be any operational DB, cache, or search framework
        console.log("Using MongoDB store as a cache!");
        MongoClient.connect(mongouri, function (err, mongoClient) {

            if (err) throw err;

            //Set up MongoDB vars for this test
            client = mongoClient;
            db = client.db('factomtestnet');

            //clear everything to test the worst case scenario of having never loaded the chain before
            db.dropDatabase();

            console.log('Cleared all local Factom Testnet entries from MongoDB\n');

            //start polling for pending entries every 10 Seconds starting immediately
            setInterval(function () {
                cachePendingEntries();
            }, 10000);
            cachePendingEntries();

            /*//attempt to cache the entire chain. This may be a long operation depending on latency and chain size!
            cacheChain(testChainID, function (err) {
                if (err) throw err;


                //also insert a new entry onto the test chain with random content for testing every 20 Seconds
                console.log('Starting test entry generator...');
                setInterval(function () {
                    commitTestEntry();
                }, 20000);
            });*/
        });

    } else if (store == 'MEMORY') {

        console.log("Using Memory store as a cache!");
        //initialize our memory store!

        //attempt to cache the entire chain. This may be a long operation depending on latency and chain size!

        //start polling for pending entries every 10 Seconds starting immediately
        setInterval(function () {
            cachePendingEntries();
        }, 10000);
        cachePendingEntries();

        /*cacheChain(testChainID, function (err) {
            if (err) throw err;



            //also insert a new entry onto the test chain with random content for testing every 20 Seconds
            console.log('Starting test entry generator...');
            setInterval(function () {
                commitTestEntry();
            }, 20000);
        });*/

    } else {
        throw new Error('Unknown store type ' + store);
    }

    function cacheChain(chainId, callback) {
        console.log('Retrieving and caching all Entries for Chain ' + chainId + '...\n');
        console.time("Get All Entries");

        //get every entry of the chain so we can store it in our local DB
        cli.getAllEntriesOfChain(chainId).then(function (entries) {
            console.timeEnd("Get All Entries");

            //convert the fields and buffers of the entry to strings and construct simple object from the result. Crude normalization
            let index = 0;
            entries = entries.map(function (entry) {
                entry = {
                    _id: entry.hashHex(), //why...
                    content: entry.contentHex,
                    extIds: entry.extIdsHex,
                    timestamp: entry.timestamp,
                    status: 'DBlockConfirmed', //mark this entry as confirmed
                    index: index //this entry's index within the chain so it can be reconstructed later
                };
                index++;
                return entry;
            });

            console.log("Got " + entries.length + ' entries');

            //switch store type
            if (store == 'MEMORY') {
                //insert in memory, overwriting previous chain entries
                chainCache.set(chainId, entries); //store all entries in the map
                console.log("Set " + chainCache.get(chainId).length + ' entries in memory');

                //mark the entries cached
                entries.forEach(function (entry) {
                    entryCache.set(entry._id, entry.status)
                });

                if (callback) callback(undefined, entries);
                return;
            }

            //otherwise mongo

            //attempt to insert the entries into the chain's MongoDB collection
            db.collection(chainId).insertMany(entries, function (err, result) {
                //if an error occurs that does not constitute a duplicate key error, handle it.
                if (err && !err.message.includes('duplicate key error')) {
                    callback(err);
                    return;
                }

                //Otherwise we're all good! Print some extra useful info for the poor soul using this
                console.time('Get Cached Entries From MongoDB');
                console.log("Entered " + entries.length + " new entries into MongoDB! (" + result.result.n + " were new)\n");
                //mark the entries cached
                entries.forEach(function (entry) {
                    entryCache.set(entry._id, entry.status)
                });

                if (callback) callback(undefined, entries);
            });
        }).catch(function (err) {
            if (callback) callback(err);
            else console.error(err);
        });
    };
    this.cacheChain = cacheChain;


    function cachePendingEntries() {
        cli.factomdApi('pending-entries', {}).then(function (pendingEntries) {
            if (pendingEntries.length == 0) {
                //No pending entries were found!
                return;
            }

            //only handle entries with hashes we have not already processed
            const preFilterCount = pendingEntries.length;
            pendingEntries = pendingEntries.filter(function (pendingEntry) {
                return !entryCache.has(pendingEntry.entryhash);
            });

            console.log(preFilterCount - pendingEntries.length + ' pending entries were already cached.');
            console.log('Found ' + pendingEntries.length + ' New Entries to cache! : ' + JSON.stringify(pendingEntries) + '\n');

            if (pendingEntries.length == 0) return; //ignore

            //get all the pending entries from Factom by hash, preserving order
            getEntriesFromFactomd(pendingEntries.map(function (entry) {
                return entry.entryhash
            }), function (err, rawEntries) {
                if (err) {
                    console.error(err);
                    return;
                }

                var chainEntries = {};

                //sort the pending entries by chain ID
                rawEntries.forEach(function (rawEntry) {
                    // console.log(rawEntry);
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

                // console.log(chainEntries);

                //for each of the chains with new entries, we need to get the latest known index of an entry in the
                // DB from the importing process and set it for the pending entry
                for (var chainid in chainEntries) {
                    if (!chainEntries.hasOwnProperty(chainid)) continue;

                    getLatestEntryIndex(chainid, function (err, index) {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        if (index > -1) index++; //if there are entries in this chain already then start from the last known one + 1
                        else index = 0; //otherwise start from scratch

                        console.log("inserting new entry with index " + index);

                        //mark every entry with it's index in the chain
                        chainEntries[chainid] = chainEntries[chainid].map(function (entry) {
                            entry.index = index;
                            index++;
                            return entry;
                        });

                        //switch store type

                        if (store == 'MEMORY') {
                            //insert new entries for the chainID in memory
                            if (chainCache.has(chainid)) {
                                chainCache.set(chainid, chainCache.get(chainid).concat(chainEntries[chainid]));
                                console.log("added new entry to memory cache chain. Length is now " + chainCache.get(chainid).length);
                                chainEntries[chainid].forEach(function (entry) {
                                    entryCache.set(entry._id, entry.status)
                                });
                            }
                            return
                        }

                        //otherwise mongo

                        db.collection(chainid).insertMany(chainEntries[chainid], function (err, result) {
                            if (err) {
                                if (!err.message.includes('duplicate key error')) {
                                    console.error(err);
                                    return;
                                }
                            }

                            console.log('Successfuly inserted chain entries for chain ' + chainid + '\n');

                            //mark the entries as cached
                            chainEntries[chainid].forEach(function (entry) {
                                entryCache.set(entry._id, entry.status)
                            });
                        });
                    })
                }
            });
        }).catch(console.error)
    }

    function commitTestEntry() {
        const entry = Entry.builder()
            .chainId(testChainID)
            .extId('' + new Date().getTime())
            .content(crypto.randomBytes(100).toString(), 'utf8')
            .build();

        cli.addEntry(entry, ES)
            .then(function (entry) {
                console.log('Created test chain entry with hash ' + entry.entryHash + '\n');
            }).catch(console.error);
    }

    function getLatestEntryIndex(chainId, callback) {
        //switch store types
        //memory
        if (store == 'MEMORY') {
            if (chainCache.has(chainId)) {
                var entries = chainCache.get(chainId);
                if (callback) callback(undefined, entries.length > 0 ? entries[entries.length - 1].index : -1);
                return;
            }
            return;
        }

        db.collection(chainId).find({}).sort({index: -1}).limit(1).toArray(function (err, entries) {
            if (err) {
                if (callback) callback(err);
                else console.error(err);
                return;
            }

            if (entries.length == 0) {
                if (callback) callback(undefined, -1);
                console.log('Found no entries for this chain!');
                return;
            }

            if (callback) callback(undefined, entries[0].index);
            console.log("last entry index was " + entries[0].index);
        })
    }

    this.getLastEntryIndex = getLatestEntryIndex;

    function getEntriesFromFactomd(hashes, callback) {
        var tasks = [];
        hashes.forEach(function (hash) {
            tasks.push(cli.getEntry(hash))
        });

        u.processArray(tasks, function (item) {
            return item;
        }).then(function (result) {
            // console.log(result);
            if (callback) callback(undefined, result);
        }, function (err) {
            console.error(err);
            if (callback) callback(err);
        })
    }

    function getAllChainEntries(chainId, callback) {
        if (store == 'MEMORY') {
            if (chainCache.has(chainId)) {
                var entries = chainCache.get(chainId);
                if (callback) callback(undefined, entries);
                return;
            } else { //otherwise get it
                cacheChain(chainId, callback);
                return;
            }
        }

        //otherwise mongodb

        //should maybe be streaming
        db.collection(chainId).find({}).sort({index: -1}).toArray(function (err, entries) {
            if (err) {
                if (callback) callback(err);
                else console.error(err);
                return;
            }

            if (entries.length == 0) {
                if (callback) callback(undefined, []);
                console.log('Found no entries for this chain!');
                return;
            }

            if (callback) callback(undefined, entries);
            console.log("last entry index was " + entries);
        });
    }

    this.getAllChainEntries = getAllChainEntries;

    function getRangedChainEntries(chainId, startIndexInclusive, endIndexExclusive, callback) {
        if (store == "MEMORY") {
            var chain = chainCache.get(chainId);
            // console.log(chain.length+' ranged entries mem')
            // console.log('startincl: '+startIndexInclusive);
            // console.log('startincl: '+startIndexInclusive);
            if (callback) callback(undefined, chain.slice(startIndexInclusive, endIndexExclusive))

        } else if (store == "MONGODB") {
            db.collection(chainId).find({
                index: {
                    $gte: startIndexInclusive,
                    $lt: endIndexExclusive
                }
            }).sort({index: -1}).toArray(function (err, entries) {
                if (err) {
                    if (callback) callback(err);
                    else console.error(err);
                    return;
                }

                if (entries.length == 0) {
                    if (callback) callback(undefined, []);
                    console.log('Found no entries for this query!');
                    return;
                }

                if (callback) callback(undefined, entries);
                console.log("last entry index was " + entries);
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

        if (store == "MEMORY") {
            var chain = chainCache.get(chainId);
            if (callback) callback(undefined, (chain.length - count <= 0) ? chain : chain.slice(chain.length - count, chain.length));
        } else if (store == "MONGODB") {
            db.collection(chainId).find({}).sort({index: -1}).skip(offset).limit(count).toArray(function (err, entries) {
                if (err) {
                    if (callback) callback(err);
                    else console.error(err);
                    return;
                }

                if (entries.length == 0) {
                    if (callback) callback(undefined, []);
                    console.log('Found no entries for this query!');
                    return;
                }

                if (callback) callback(undefined, entries);
                console.log("last entry index was " + entries);
            });
        }
    }

    this.getLatestChainEntries = getLatestChainEntries;

    return this;
}

module.exports = {
    FactomdCache: FactomdCache
}
const crypto = require('crypto');

const {FactomCli} = require('factom');
const {Entry} = require('factom/src/entry');
const {Chain} = require('factom/src/chain');

const MongoClient = require('mongodb').MongoClient;
let client;

let db;

//set up simple key:value cache to track entryhash existence and status
const entryCache = new Map();

//Testnet credentials, enjoy the 10,000 testnet EC's!
const EC = 'EC1tE4afVGPrBUStDhZPx1aHf4yHqsJuaDpM7WDbXCcYxruUxj2D';
const ES = 'Es3k4L7La1g7CY5zVLer21H3JFkXgCBCBx8eSM2q9hLbevbuoL6a';

//you must have a testnet wallet running locally on port 8089 for this to work!
const cli = new FactomCli({
    factomd: {
        host: '88.200.170.90' //ilzheev (De Facto)#4781 on Discord's testnet courtesy node
    }
});

//Testnet Chain ID:
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

//Connect to the local MongoDB server. This could be any operational DB, cache, or search framework
MongoClient.connect('mongodb://localhost:27017', function (err, mongoClient) {

    if (err) throw err;

    //Set up MongoDB vars for this test
    client = mongoClient;
    db = client.db('factomtestnet');

    //clear everything to test the worst case scenario of having never loaded the chain before
    db.dropDatabase();

    console.log('Cleared all local Factom Testnet entries from MongoDB\n');

    //attempt to cache the entire chain. This may be a long operation depending on latency and chain size!
    cacheChain(testChainID, function (err) {
        if (err) throw err;

        //start polling for pending entries every 10 Seconds starting immediately
        setInterval(function () {
            cachePendingEntries();
        }, 10000);
        cachePendingEntries();

        //also insert a new entry onto the test chain with random content for testing every 20 Seconds
        console.log('Starting test entry generator...');
        setInterval(function () {
            commitTestEntry();
        }, 20000);
    });
});

function cacheChain(chain_id, callback) {
    console.log('Retrieving and caching all Entries for Chain ' + chain_id + '...\n');
    console.time("Get All Entries");

    //get every entry of the chain so we can store it in our local DB
    cli.getAllEntriesOfChain(chain_id).then(function (entries) {
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

        //attempt to insert the entries into the chain's MongoDB collection
        db.collection(chain_id).insertMany(entries, function (err, result) {
            //if an error occurs that does not constitute a duplicate key error, handle it.
            if (err && !err.message.includes('duplicate key error')) {
                callback(err);
                return;
            }

            //Otherwise we're all good! Print some extra useful info for the poor soul using this
            console.time('Get Cached Entries From MongoDB');
            console.log("Entered " + entries.length + " new entries into MongoDB! (" + result.result.n + " were new)\n");
            if (callback) callback();
        });
    }).catch(function (err) {
        if (callback) callback(err);
        else console.error(err);
    });
}

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
        getEntries(pendingEntries.map(function (entry) {
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

                    db.collection(chainid).insertMany(chainEntries[chainid], function (err, result) {
                        if (err) {
                            if (!err.message.includes('duplicate key error')) {
                                console.error(err);
                                return;
                            }
                        }

                        console.log('Successfuly inserted chain entries for chain ' + chainidchain entries + '\n');

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

function getEntries(hashes, callback) {
    var tasks = [];
    hashes.forEach(function (hash) {
        tasks.push(cli.getEntry(hash))
    });

    processArray(tasks, function (item) {
        return item;
    }).then(function (result) {
        // console.log(result);
        if (callback) callback(undefined, result);
    }, function (err) {
        console.error(err);
        if (callback) callback(err);
    })
}

function processArray(array, fn) {
    var results = [];
    return array.reduce(function (p, item) {
        return p.then(function () {
            return fn(item).then(function (data) {
                results.push(data);
                return results;
            });
        });
    }, Promise.resolve());
}
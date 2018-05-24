const crypto = require('crypto');

const {FactomCli} = require('factom');
const {Entry} = require('factom/src/entry');

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
const testChainID = '5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456';

//Connect to the local MongoDB server. This could be any operational DB, cache, or search framework
MongoClient.connect('mongodb://localhost:27017', function (err, mongoClient) {

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

    //attempt to cache the entire chain. This may be a long operation depending on latency and chain size!
    cacheChain(testChainID, function (err) {
        if (err) throw err;

        //also insert a new entry onto the test chain with random content for testing every 30 Seconds starting immediately
        console.log('Starting test entry generator...');
        setInterval(function () {
            commitTestEntry();
        }, 30000);
        commitTestEntry();
    });
});

function cacheChain(chain_id, callback) {
    console.log('Retrieving and caching all Entries for Chain ' + chain_id + '...\n');
    console.time("Get All Entries");

    //get every entry of the chain so we can store it in our local DB
    cli.getAllEntriesOfChain(chain_id).then(function (entries) {
        console.timeEnd("Get All Entries");

        //convert the fields and buffers of the entry to strings and construct simple object from the result. Crude normalization
        entries = entries.map(function (entry) {
            entry = {
                _id: entry.hashHex(), //omg why...
                content: entry.contentHex,
                extIds: entry.extIdsHex,
                timestamp: entry.timestamp,
                status: 'DBlockConfirmed'
            };
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
            callback();
        });
    }).catch(function (err) {
        callback(err)
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

        pendingEntries.forEach(function (pendingEntry) {
            cli.getEntry(pendingEntry.entryhash).then(function (entry) {
                // console.log(entry);
                const mongoEntry = {
                    _id: entry.hashHex(), //oh my god why is this one inconsistent with the others?
                    content: entry.contentHex,
                    extIds: entry.extIdsHex,
                    status: pendingEntry.status
                };

                //attempt to insert into the local DB. Will not error if duplicate
                db.collection(pendingEntry.chainid).insertOne(mongoEntry, function (err, result) {
                    if (err) {
                        if (!err.message.includes('duplicate key error')) {
                            console.error(err);
                            return;
                        }
                    }
                    //mark this entry as cached
                    entryCache.set(pendingEntry.entryhash, pendingEntry.status)
                });
            }).catch(console.error)
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
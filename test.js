const crypto = require('crypto');

const {FactomdCache} = require('./FactomdCache');

const {FactomCli} = require('factom');
const {Entry} = require('factom/src/entry');
const {Chain} = require('factom/src/chain');

//Testnet credentials, enjoy the free testnet EC's!
const EC = 'EC1tE4afVGPrBUStDhZPx1aHf4yHqsJuaDpM7WDbXCcYxruUxj2D';
const ES = 'Es3k4L7La1g7CY5zVLer21H3JFkXgCBCBx8eSM2q9hLbevbuoL6a';

//you must have a wallet running locally on port 8089 for this to work!
var cli = new FactomCli({
    factomd: {
        host: '88.200.170.90' //ilzheev (De Facto)#4781 on Discord's testnet courtesy node
    }
});

//Testnet test Chain ID:
const testChainID = 'f1be007d4b82e7093f2234efd1beb429bc5e0311e9ae98dcd580616a2046a6b3';


//EXECUTE TESTS
var factomdCache = new FactomdCache({
    factomdparams: {
        factomd: {
            host: '88.200.170.90' //ilzheev (De Facto)#4781 on Discord's testnet courtesy node
        }
    }
});

//cache a test chain
factomdCache.cacheChain(testChainID, function (err, entries) {
    if (err) throw err;

    console.log('cached ' + entries.length + ' entries!\n');

    //get the index of the latest cached entry
    factomdCache.getLatestChainEntry(testChainID, function (err, entry) {
        if (err) throw err;

        console.log("the latest entry in the test chain was:\n" + JSON.stringify(entry, undefined, 2) + '\n');
    });

    //get the index of the latest cached entry
    factomdCache.getLatestChainEntryIndex(testChainID, function (err, index) {
        if (err) throw err;

        console.log("the latest entry index in the test chain had index " + index + '\n');
    });

    //get all the entries for the test chain
    factomdCache.getAllChainEntries(testChainID, function (err, entries) {
        if (err) throw err;

        console.log('retrieved all entries! (' + entries.length + ' total)\n');
    });

    //get the most recent 15 entries for the test chain
    factomdCache.getLatestChainEntries(testChainID, 15, function (err, entries) {
        if (err) throw err;

        console.log("got " + entries.length + ' latest entries!\n');
    });

    //get entries by index range
    factomdCache.getRangedChainEntries(testChainID, 0, 20, function (err, entries) {
        if (err) throw err;

        console.log("success got " + entries.length + ' entries by index range!\n');
    });

    //start writing new entries to the chain to test if this lib works!
    setInterval(function () {
        commitTestEntry();
    }, 20000)
});

//test functions
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

function commitTestChain() {

    const entry = Entry.builder()
        .extId(crypto.randomBytes(16).toString(), 'utf8')
        .content(crypto.randomBytes(100).toString(), 'utf8')
        .build();

    var chain = new Chain(entry);

    cli.addChain(chain, ES)
        .then(function (chain) {
            console.log('Created test chain ');
            console.log(chain)
        }).catch(console.error);
}


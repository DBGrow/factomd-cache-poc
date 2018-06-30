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
    factomdParams: {
        factomd: {
            host: '88.200.170.90' //ilzheev (De Facto)#4781 on Discord's testnet courtesy node
        }
    }
});

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

        //evaluate the cached chain for consistency
        if (entries[0].index != 0) console.error('Entries 0 index was not 0!');
        if (entries[entries.length - 1].index != entries.length - 1) console.error('Entries max index inconsistent! ' + entries[entries.length - 1].index)

        //check that the index is increasing and there are no duplicates
        let previous;
        entries.forEach(function (entry) {
            if (previous && entry.index != previous.index + 1) console.error(entry.index + ' not one greater than ' + previous.index);
            previous = entry;
        });
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

    //write a new entry to the chain to test if we get new entries as they come in
    setTimeout(function () {
        commitTestEntry();
    }, 20000);

    //listen for new entries that come in
    factomdCache.on('new-entries', testChainID, function (newEntries) {
        console.log('Got ' + newEntries.length + ' new entries in ON listnener');
    });

    //clear the test chain from the cache
    setTimeout(function () {
        factomdCache.clearChain(testChainID);
        console.log('Cleared chain ' + testChainID);
    }, 50000);
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


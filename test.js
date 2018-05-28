const {FactomdCache} = require('./index');


//Testnet test Chain ID:
const testChainID = 'f1be007d4b82e7093f2234efd1beb429bc5e0311e9ae98dcd580616a2046a6b3';


var factomdCache = new FactomdCache();

//cache a test chain
factomdCache.cacheChain(testChainID, function (err, entries) {
    if (err) throw err;

    console.log('cached ' + entries.length + ' entries!\n');

    //get the index of the latest cached entry
    factomdCache.getLastEntryIndex(testChainID, function (err, index) {
        if (err) throw err;

        console.log("the latest entry index in the test chain is " + index + '\n');
    });

    //get all the ntries for the test chain
    factomdCache.getAllChainEntries(testChainID, function (err, entries) {
        if (err) throw err;

        console.log('retrieved ' + entries.length + ' entries!\n');
    });

    //get the most recent 15 entries for the test chain
    factomdCache.getLatestChainEntries(testChainID, 15, function (err, entries) {
        if (err) throw err;

        console.log("success got " + entries.length + ' latest entries!\n');
    });

    //get entries by index range
    factomdCache.getRangedChainEntries(testChainID, 0, 20, function (err, entries) {
        if (err) throw err;

        console.log("success got " + entries.length + ' entries by index range!\n');
    });
});

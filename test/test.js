var assert = require('assert');
const {FactomCli} = require('factom');
const {Entry} = require('factom/src/entry');
var cli = new FactomCli({
    factomd: {
        host: 'localhost',
        port: 8088
    }
});

async function test() {
    let dblocks = await getDBlocksFromFactomdAPI(blockHeights);
}

const {FactomdCache} = require('../FactomdCache');
var factomdCache = new FactomdCache({
    factomdParams: {
        factomd: {
            host: 'localhost',
            port: 8088
        }
    }
});

//test creds & info
const testChainID = 'f1be007d4b82e7093f2234efd1beb429bc5e0311e9ae98dcd580616a2046a6b3';
const ES = 'Es3k4L7La1g7CY5zVLer21H3JFkXgCBCBx8eSM2q9hLbevbuoL6a';

describe('Entry/Chain Cache', function () {

    it('Cache Chain  (From API/Scratch)', async function () {
        this.timeout(10000);
        let entries = await factomdCache.cacheChain(testChainID);

        assert(entries, 'Entries were not returned from the cache');
        assert(Array.isArray(entries), 'Entries was not an array');

        assert(entries.every(function (entry) {
            return entry instanceof Entry;
        }), 'Entries were not all of type Entry!');

        //check the ordering against the normal response from the API
        let apiEntries = await cli.getAllEntriesOfChain(testChainID);

        //slice off any pending entries since we're ahead of the API
        let cacheEntries = entries.slice(0, apiEntries.length);

        assert(apiEntries.length === cacheEntries.length, 'Lengths between trimmed cache and API are unequal');

        for (let i = 0; i < apiEntries.length; i++) {
            let apiEntry = apiEntries[i];
            let cacheEntry = cacheEntries[i];
            //
            if (apiEntry.hashHex() !== cacheEntry.hashHex()) {
                console.log(apiEntry.hashHex(), cacheEntry.hashHex());
            }
            assert(apiEntry.hashHex() === cacheEntry.hashHex(), 'Cached Entry came out of order from the Factom API');
        }
    });

    it('Cache Chain (From Cache)', async function () {
        let cacheEntries = await factomdCache.cacheChain(testChainID);

        assert(cacheEntries, 'Entries were not returned from the cache');
        assert(Array.isArray(cacheEntries), 'Entries was not an array');

        assert(cacheEntries.every(function (entry) {
            return entry instanceof Entry;
        }), 'Entries were not all of type Entry!');

        //check the ordering against the normal response from the API
        let apiEntries = await cli.getAllEntriesOfChain(testChainID);

        //we should at least be synced up with the API
        assert(cacheEntries.length >= apiEntries.length, 'Cache was behind API (' + cacheEntries.length + ' vs ' + apiEntries.length + ')');

        //slice off any pending entries since we're ahead of the API
        cacheEntries = cacheEntries.slice(0, apiEntries.length);

        assert(apiEntries.length === cacheEntries.length, 'Lengths between trimmed cache and API are unequal');

        for (let i = 0; i < apiEntries.length; i++) {
            let apiEntry = apiEntries[i];
            let cacheEntry = cacheEntries[i];
            assert(apiEntry.hashHex() === cacheEntry.hashHex(), 'Cached Entry came out of order from API');
        }
    });

    it('Get All Entries', async function () {
        let entries = await factomdCache.getAllChainEntries(testChainID);

        assert(entries, 'All Entries were not returned from the cache');
        assert(Array.isArray(entries), 'All Entries was not an array');

        assert(entries.every(function (entry) {
            return entry instanceof Entry;
        }), 'Entries were not all of type Entry!');
    });

    it('Get All Entries (From API/Scratch)', async function () {
        factomdCache.clearChain(testChainID);
        let entries = await factomdCache.getAllChainEntries(testChainID);

        assert(entries, 'All Entries were not returned from the cache');
        assert(Array.isArray(entries), 'All Entries was not an array');

        assert(entries.every(function (entry) {
            return entry instanceof Entry;
        }), 'Entries were not all of type Entry!');
    });

    it('Get Latest Entries Of Chain', async function () {
        let entries = await factomdCache.getLatestChainEntries(testChainID);

        assert(entries, 'Latest entries were not returned from the cache');
        assert(Array.isArray(entries), 'Latest entries were not an array');

        assert(entries.every(function (entry) {
            return entry instanceof Entry;
        }), 'Entries were not all of type Entry!');

        entries = await factomdCache.getLatestChainEntries(testChainID, 5);
        assert(entries.length === 5, "Limiting entry count had no effect");

        //test with invalid input
        let err = false;
        try {
            await factomdCache.getLatestChainEntries(testChainID, 'a');
        } catch (e) {
            err = true;
        } finally {
            assert(err, 'Error was not caught with non numeric input')
        }
    });

    it('Get Ranged Entries', async function () {
        let entries = await factomdCache.getRangedChainEntries(testChainID, 5, 10);

        assert(entries, 'Ranged entries were not returned from the cache');

        assert(entries.length === 5, 'Ranged entries were not of the proper count (is ' + entries.length + ', should be 5)');

        assert(entries.every(function (entry) {
            return entry instanceof Entry;
        }), 'Ranged Entries were not all of type Entry!');
    });

    it('Get Ranged Entries (From API/Scratch)', async function () {
        factomdCache.clearChain(testChainID);

        let entries = await factomdCache.getRangedChainEntries(testChainID, 5, 10);

        assert(entries, 'Ranged entries were not returned from the cache');

        assert(entries.length === 5, 'Ranged entries were not of the proper count (is ' + entries.length + ', should be 5)');

        assert(entries.every(function (entry) {
            return entry instanceof Entry;
        }), 'Ranged Entries were not all of type Entry!');
    });


    it('Get Latest Entry Of Chain', async function () {
        let entry = await factomdCache.getLatestChainEntry(testChainID);

        assert(entry, 'Latest entries were not returned from the cache');

        assert(entry instanceof Entry, 'Entry was not of type Entry!');
    });

    it('Get Latest Entry Of Chain (From API/Scratch)', async function () {
        factomdCache.clearChain(testChainID);

        let entry = await factomdCache.getLatestChainEntry(testChainID);

        assert(entry, 'Latest entries were not returned from the cache');

        assert(entry instanceof Entry, 'Entry was not of type Entry!');
    });

    it('Detect A Pending Entry', function (done) {
        this.timeout(60000);

        //send a test entry to test if the lib is properly detecting pending entries
        let entry = Entry.builder()
            .chainId(testChainID)
            .extId('' + new Date().getTime())
            .content(require('crypto').randomBytes(100).toString(), 'utf8')
            .build();

        cli.addEntry(entry, ES).then(function () {
            factomdCache.on('new-entries', testChainID, function (entries) {
                assert(entries, 'Pending Entries were not returned');
                assert(Array.isArray(entries), 'Pending Entries were not an array');
                assert(entries.length > 0, 'Pending Entries did not contain any entries (false positive)');

                // assert(entries.length === 1, 'Pending Entries length was not 1');

                assert(entries.every(function (entry) {
                    return entry instanceof Entry;
                }), 'Pending Entries were not all of type Entry!');
                done()
            });
        });
    });

    it('Is Chain Cached', async function () {
        let cached = factomdCache.isChainCached(testChainID);
        assert(cached, 'chain should be cached');

        factomdCache.clearChain(testChainID);
        cached = factomdCache.isChainCached(testChainID);
        assert(!cached, 'chain should not be cached after clearing');
    });

    it('Close Cache', async function () {
        factomdCache.close();
    });
});
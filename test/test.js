var assert = require('assert');
const {FactomCli} = require('factom');
const {Entry} = require('factom/src/entry');
var cli = new FactomCli({
    factomd: {
        host: 'localhost',
        port: 8088
    }
});

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

describe('Entry/Chain Cache Test', function () {

    it('Cache Chain', async function () {
        let entries = await factomdCache.cacheChain(testChainID);

        assert(entries, 'Entries were not returned from the cache');
        assert(Array.isArray(entries), 'Entries was not an array');

        assert(entries.every(function (entry) {
            return entry instanceof Entry;
        }), 'Entries were not all of type Entry!');
    });

    it('Get All Entries', async function () {
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
    });

    it('Get Latest Entry Of Chain', async function () {
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
                assert(entries.length === 1, 'Pending Entries length was not 1');
                assert(entries.every(function (entry) {
                    return entry instanceof Entry;
                }), 'Pending Entries were not all of type Entry!');
                done()
            });
        });
    });

    it('Close Cache', async function () {
        factomdCache.close();
    });
});
# factomd-cache
A caching layer for the Factom API. Improves the performance of querying over and searching through chains on the Factom API using a hybrid memory+disk cache.

The cache polls for new pending entries and stores them in the cache (every 10 seconds by default).

Compatible with [Factom.js](https://www.npmjs.com/package/factom) by [Paul Bernier](https://github.com/PaulBernier) for you other NodeJS heads!



# Installing

#### Command Line

```bash
npm i factomd-cache
```



#### package.json

```json
"dependencies": {
	"factomd-cache": "^0.2.0"
}
```



# Examples

###  Initialization

```javascript
const {FactomdCache} = require('factomd-cache');

//default settings: FactomdAPI on localhost:8088, localhost wallet on port 8089
var factomdCache = new FactomdCache();

//alternate configuration options
var factomdCache = new FactomdCache({
    factomdParams:{ //see https://www.npmjs.com/package/factom#instantiate-factomcli
		factomd: {
            host: 'localhost',
            port: 8088
		}
    }  	
});
```





### Cache a Chain

Before anything meaningful can be done, the chain must be retrieved from Factom and stored! You can call `cacheChain` in advance when you know a chain your application will need to access often.

Calling other functions before calling `cacheChain` will cause an implicit call to `cacheChain` before the desired function's callback completes. 

After a chain is cached, new and currently pending entries will be synced on a 10 second basis.

```javascript
//Testnet test Chain ID:
const testChainID = 'f1be007d4b82e7093f2234efd1beb429bc5e0311e9ae98dcd580616a2046a6b3';

//use async/await
let entries = await factomdCache.cacheChain(testChainID);

//or promises
let entries = factomdCache.cacheChain(testChainID)
.then(function(entries){
    console.log('chain is cached!');
}).catch(function(err){throw err});

```





### Get All Entries For a Chain

```javascript
let entries = await factomdCache.getAllChainEntries(testChainID);
```





### Get The Latest Entries For a Chain

```javascript
//get the most recent 25 entries for the test chain
 let entries = await factomdCache.getLatestChainEntries(testChainID);

//specify count
let entries = await factomdCache.getLatestChainEntries(testChainID, 20);
```





### Get Entries For a Chain By Index Range

You can get entries by chronological index!

```javascript
//get entries from index range 5 (inclusive) to 10(exclusive)
let entries = await factomdCache.getRangedChainEntries(testChainID, 5, 10);
```





### Listen For New Entries

You can listen for new entries by chain as they're committed to Factom. The chain must be in the cache to receive events

```javascript
factomdCache.on('new-entries', testChainID, function (newEntries) {
        console.log('Got ' + newEntries.length + ' new entries in listnener for chain '+testChainID);
});
```





### Clear A Chain From The Cache

Clear a single chain from the cache by ID. This will stop any pending entry listeners for your chain and clear the memory+disk cache.

```javascript
factomdCache.clearChain(testChainID);
```



### Close The Cache

Stops all event listeners

```javascript
factomdCache.close();
```





# Testing

#### Command Line

```bash
npm test
```
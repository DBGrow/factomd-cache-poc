# factomd-cache
A memory+disk caching layer for the Factomd API.

Can store all entries of a chain so they may be queried through and returned later lightning quick!

Will also poll for new pending entries every 10 seconds and store them in the cache.



# Installing

Command line:

```bash
npm i factomd-cache
```



# Examples

###  Initialization

```javascript
const {FactomdCache} = require('factomd-cache');

//default settings: FactomdAPI on localhost:8088, localhost wallet on port 8089
var factomdCache = new FactomdCache();

//all configuration options
var factomdCache = new FactomdCache({
    factomdparams:{ //see https://www.npmjs.com/package/factom#instantiate-factomcli
		factomd: {
        host: '88.200.170.90' //ilzheev (De Facto)#4781 on Discord's testnet courtesy node
		}
    }  	
});
```





### Cache a Chain

Before anything meaningful can be done, the chain must be retrieved from Factom and stored!

Performing chain operations before calling `cacheChain` will cause an implicit call to `cacheChain` before the desired function's callback completes. You can call `cacheChain` in advance when you know a chain your application will need to access often.

After a chain is cached, new entries will automatically be added on a 10 second basis.

```javascript
//Testnet test Chain ID:
const testChainID = 'f1be007d4b82e7093f2234efd1beb429bc5e0311e9ae98dcd580616a2046a6b3';

var factomdCache = new FactomdCache();

//Cache the chain. If it is large this could take a while.
factomdCache.cacheChain(testChainID, function (err, entries) {
    if (err) throw err;

	//The chain has been cached!
	
    console.log('cached ' + entries.length + ' entries!');
});
```





### Get All Entries For a Chain

```javascript
factomdCache.getAllChainEntries(testChainID, function (err, entries) {
	if(err) throw err;
        
	console.log('retrieved ' + entries.length + ' entries from the cache!');
});
```





### Get The Latest Entries For a Chain

```javascript
//get the most recent 15 entries for the test chain
factomdCache.getLatestChainEntries(testChainID, 15, function (err, entries) {
	if (err) throw err;

    console.log("success got " + entries.length + ' latest entries!\n');
});
```





### Get Entries For a Chain By Index Range

You can get entries by chronological index!

```javascript
//get entries by index range, from index 0 (inclusive) to index 20 (exclusive)
factomdCache.getRangedChainEntries(testChainID, 0, 20, function (err, entries) {
	if (err) throw err;

	console.log("success got " + entries.length + ' entries by index range!\n');
});
```

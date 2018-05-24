# factomd-cache-poc
Proof of concept project for a MongoDB based Factomd API database/cache. Standalone project for the time being.

Usable from the terminal and NodeJS compatible IDEs.

Can store all entries of a chain so they may be queried through later and returned lightning quick!

Will also poll for new(pending) entries every 10 seconds and store them in the database.

# Requirements
* A Localhost [MongoDB](https://docs.mongodb.com/manual/installation/) server with no auth.
A funded testnet EC and ES address are supplied in the project.

# Running
Simply `node index.js` :)

# DB and Collection Structure
Will create the database 'factomtestnet' on the local MongoDB server.

Each chain's entries are separated into it's own collection for convenience and query efficiency.

# Getting all Entries in a Chain in chronological from the DB in NodeJS
```
 db.collection(chainId).find({}).sort({index: 1}).toArray(function (err, entries) {
        if (err) throw err;
        console.log(JSON.stringify(entries,undefined,2));
 });
```
results in
```
[
    {
        "_id" : "c626da966b8a974d45d4b3b6e7b02e06d4b19a36bc60ac6fc7701665db6c38e2",
        "content" : "38efbfbd1defbfbdefbfbd3aefbfbdefbfbd1b0cefbfbd337315efbfbdefbfbdefbfbd723961efbfbd7defbfbdefbfbd234c6600efbfbd22f180ad95efbfbd18efbfbd35efbfbdefbfbdefbfbd59efbfbd390c3eefbfbd43efbfbdefbfbd5c274aefbfbd3320602e3cefbfbd4e35efbfbd284126efbfbd19efbfbd39057c1befbfbd2defbfbdefbfbd76efbfbdefbfbdefbfbd16efbfbdefbfbd0aefbfbd2232efbfbdefbfbd19064219efbfbd27efbfbd2cefbfbd76",
        "extIds" : [
            "152713198179"
        ],
        "timestamp" : 1527132000000.0,
        "status" : "DBlockConfirmed",
        "index" : 0
    },

    {
        "_id" : "f92aa5bfa83af4031607c8a534b5279e797b713dae603cb1b02655b631c399f0",
        "content" : "de99311476693758003017160eefbfbdefbfbdefbfbd77161708efbfbde9bfa11fefbfbd730eefbfbdefbfbd2d30efbfbdefbfbdefbfbdefbfbd4befbfbd3d6512097364efbfbd7e13efbfbdefbfbd65efbfbdc3acefbfbdefbfbd63d58649efbfbd433a78c8b93c06cda9efbfbdefbfbd31efbfbdefbfbd4107efbfbd1b7628527cefbfbdefbfbdefbfbd4e0661efbfbdefbfbd41efbfbdefbfbd675befbfbd545b",
        "extIds" : [
            "152713260262"
        ],
        "status" : "TransactionACK",
        "index" : 1
    },

    {
        "_id" : "d2a293ecce8641b72711621a1adacba9811618721754d643d722f4c50a35b36e",
        "content" : "175b503342efbfbdefbfbd3b6fefbfbd4b360aefbfbdefbfbd1013345eefbfbd194e26efbfbd5e0b673cefbfbd4378efbfbd5453efbfbdefbfbd6b0446efbfbdefbfbd115677efbfbd45212fefbfbdefbfbd0865efbfbdefbfbd1aefbfbdefbfbd6befbfbdefbfbd7a3b26efbfbd651eefbfbdefbfbd382162135171efbfbd54dcb2efbfbd765216efbfbdefbfbd39efbfbdefbfbd1240efbfbdefbfbdefbfbd296a07efbfbdefbfbdefbfbd67",
        "extIds" : [
            "152713262263"
        ],
        "status" : "TransactionACK",
        "index" : 2
    },
...
]
```
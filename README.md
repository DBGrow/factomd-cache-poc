# factomd-cache-poc
Proof of concept project for a MongoDB based Factomd API database/cache Standalone for the time being.

Usable from the terminal and NodeJS compatible IDEs.

Can store all entries of a chain so they may be queried through later and returned lightning quick!

Will also poll for new(pending) entries every 10 seconds and store them in the database.

#Requirements
* Localhost [MongoDB](https://docs.mongodb.com/manual/installation/) server with no auth.
A funded testnet EC and ES address are supplied in the project.

# Running
Simply `node index.js` :)

# DB and Collection Structure
will create the database 'factomtestnet' on the local MongoDB server.

Each chain ID is separated into it's own collection for convenience and query efficiency.

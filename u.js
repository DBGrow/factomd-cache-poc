module.exports = {

    processArray: function processArray(array, callback, progressCallback) {
        var results = [];
        return array.reduce(function (p, item) {
            return p.then(function () {

                return callback(item).then(function (data) {
                    results.push(data);
                    if (progressCallback) progressCallback(array.length, results.length, (results.length / array.length).toFixed(2));
                    return results;
                }).catch(function (err) {
                    console.error(err);
                    return [];
                });
            });
        }, Promise.resolve());
    }

}
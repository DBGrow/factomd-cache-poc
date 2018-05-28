module.exports = {

    processArray: function processArray(array, fn) {
        var results = [];
        return array.reduce(function (p, item) {
            return p.then(function () {
                return fn(item).then(function (data) {
                    results.push(data);
                    return results;
                }).catch(function (err) {
                    console.error(err);
                    return [];
                });
            });
        }, Promise.resolve());
    }

}
// What the tests get for `electron`: in plain Node the package only exports the path of its binary, never the API, so main modules already
// read `app` and friends as undefined. Resolving that path downloads the binary when it is missing, which no test may do.
export {};

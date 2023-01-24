import express from 'express';
const app = express();

// link compiled TS to /js route
app.use('/js', express.static('./dist/js'));
// link everything else from html folder
app.use('/', express.static('./src/html'));

app.listen(3000, () => {
    console.log('Server listening on port 3000...');
});
const express = require('express');
const app = express();
const path = require('path');

// Serve static files from the current directory
app.use(express.static(__dirname));

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`View report at http://localhost:${PORT}/followers-report.html`);
}); 
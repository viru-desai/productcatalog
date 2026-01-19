const http = require('http');
const mysql = require('mysql');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const formidable = require('formidable');
const IncomingForm = formidable.IncomingForm;

// Upload directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// MySQL connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'root123',
  database: 'minor',
});
db.connect((err) => {
  if (err) throw err;
  console.log('✅ Connected to MySQL');
});

// JSON Response Helper
const sendJSON = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

// Server
const server = http.createServer((req, res) => {
  // CORS setup
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();

  // Login
  if (req.method === 'POST' && req.url === '/login') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { email, password } = JSON.parse(body);
      db.query(
        'SELECT * FROM users WHERE email = ? AND password = ?',
        [email, password],
        (err, results) => {
          if (err) return sendJSON(res, 500, { error: 'Server error' });
          if (results.length > 0) {
            const token = crypto.randomBytes(16).toString('hex');
            sendJSON(res, 200, { token, role: results[0].role });
          } else {
            sendJSON(res, 401, { error: 'Invalid credentials' });
          }
        }
      );
    });
  }

  // Signup
  else if (req.method === 'POST' && req.url === '/signup') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { email, password } = JSON.parse(body);
      db.query(
        'INSERT INTO users (email, password, role) VALUES (?, ?, "user")',
        [email, password],
        (err) => {
          if (err) return sendJSON(res, 400, { error: 'User already exists' });
          sendJSON(res, 200, { message: 'Signup successful' });
        }
      );
    });
  }

  // Add product
  else if (req.method === 'POST' && req.url === '/add-product') {
    const form = new IncomingForm({ uploadDir, keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) return sendJSON(res, 500, { error: 'Form parse error' });

      const name = fields.name?.[0] || '';
      const price = fields.price?.[0] || '';
      const image = files.image?.[0] ? path.basename(files.image[0].filepath) : '';

      if (!name || !price) return sendJSON(res, 400, { error: 'Missing fields' });

      db.query(
        'INSERT INTO products (name, price, image) VALUES (?, ?, ?)',
        [name, price, image],
        (err) => {
          if (err) return sendJSON(res, 500, { error: 'Insert failed' });
          sendJSON(res, 200, { message: 'Product added' });
        }
      );
    });
  }

  // Get products
  else if (req.method === 'GET' && req.url === '/products') {
    db.query('SELECT * FROM products', (err, results) => {
      if (err) return sendJSON(res, 500, { error: 'Query failed' });
      sendJSON(
        res,
        200,
        results.map((p) => ({
          ...p,
          image: `http://localhost:5000/uploads/${p.image}`,
        }))
      );
    });
  }

  // Delete product
  else if (req.method === 'DELETE' && req.url.startsWith('/delete-product/')) {
    const id = req.url.split('/').pop();
    db.query('DELETE FROM products WHERE id = ?', [id], (err) => {
      if (err) return sendJSON(res, 500, { error: 'Delete failed' });
      sendJSON(res, 200, { message: 'Product deleted' });
    });
  }

  // Update product
else if (req.method === 'POST' && req.url.startsWith('/update-product/')) {
  const id = req.url.split('/').pop();

  const uploadDir = path.join(__dirname, 'uploads'); // make sure this exists
  const form = new formidable.IncomingForm({
    uploadDir,
    keepExtensions: true
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Form error' }));
      return;
    }

    const name = fields.name?.[0] || '';
    const price = fields.price?.[0] || '';

    let sql, params;
    if (files.image?.[0]) {
      const image = path.basename(files.image[0].filepath);
      sql = 'UPDATE products SET name = ?, price = ?, image = ? WHERE id = ?';
      params = [name, price, image, id];
    } else {
      sql = 'UPDATE products SET name = ?, price = ? WHERE id = ?';
      params = [name, price, id];
    }

    db.query(sql, params, (err, result) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }
    });
  });
}



  // Place order + generate invoice.txt
  else if (req.method === 'POST' && req.url === '/place-order') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { productId, productName, productPrice, userName, address, pincode } = JSON.parse(body);

      db.query(
        'INSERT INTO orders (product_id, product_name, product_price, user_name, address, pincode) VALUES (?, ?, ?, ?, ?, ?)',
        [productId, productName, productPrice, userName, address, pincode],
        (err) => {
          if (err) return sendJSON(res, 500, { error: 'Order failed' });

          // Generate Invoice
          const invoice = `
🧾 INVOICE - Fake Bill
-------------------------
Name: ${userName}
Product: ${productName}
Price: ₹${productPrice}
Address: ${address}
Pincode: ${pincode}
Date: ${new Date().toLocaleString()}
-------------------------
Thank you for your order!
`;

          const invoiceFile = path.join(__dirname, 'invoices');
          if (!fs.existsSync(invoiceFile)) fs.mkdirSync(invoiceFile);

          const filePath = path.join(invoiceFile, `${userName.replace(/\s+/g, '_')}_${Date.now()}.txt`);
          fs.writeFileSync(filePath, invoice);

          sendJSON(res, 200, { message: 'Order placed successfully. Invoice generated.' });
        }
      );
    });
  }

  // Get orders
  else if (req.method === 'GET' && req.url === '/orders') {
    db.query('SELECT * FROM orders', (err, results) => {
      if (err) return sendJSON(res, 500, { error: 'Query error' });
      sendJSON(res, 200, results);
    });
  }

  // Serve image
  else if (req.method === 'GET' && req.url.startsWith('/uploads/')) {
    const imagePath = path.join(__dirname, req.url);
    fs.readFile(imagePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Image not found');
      } else {
        res.writeHead(200);
        res.end(data);
      }
    });
  }

  // 404 fallback
  else {
    res.writeHead(404);
    res.end('Route not found');
  }
});

// Start server
server.listen(5000, () => {
  console.log('🚀 Server running at http://localhost:5000');
});

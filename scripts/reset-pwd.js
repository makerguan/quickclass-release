const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../prisma/dev.db');
const db = new sqlite3.Database(dbPath);

const phone = '13800138000';
const password = '123456';

// 生成密码哈希
const hash = bcrypt.hashSync(password, 10);
console.log('Generated hash:', hash);

// 更新数据库
db.run('UPDATE User SET password = ? WHERE phone = ?', [hash, phone], function(err) {
  if (err) {
    console.error('Update error:', err);
  } else {
    console.log('Rows updated:', this.changes);
    
    // 验证更新
    db.get('SELECT password FROM User WHERE phone = ?', [phone], (err, row) => {
      if (err) {
        console.error('Query error:', err);
      } else if (row) {
        const verified = bcrypt.compareSync(password, row.password);
        console.log('Password verified:', verified);
      }
      db.close();
    });
  }
});

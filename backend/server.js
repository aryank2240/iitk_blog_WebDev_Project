// backend/server.js

import blog from './Routes/blog.js'
import tag from './Routes/tag.js'
import user from './Routes/user.js'
import comment from './Routes/comment.js'
import express from 'express'
import cors from 'cors'
import db from './config/db.js'


const app = express();
const PORT = 6000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/blog', blog);
app.use('/api/user', user);
app.use('/api/tag', tag);
app.use('/api/comment', comment);




app.get("/", (req, res) => {
  res.json({ message: "hello there, this is backend!" });
});


app.get("/api/about", (req, res) => {
  res.json({ message: "this is about!" });
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_wd1QcBhmzWy4@ep-proud-wind-a1pj1asa-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
});

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'steam_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 } // 1시간 유지
}));

// 로그인 정보를 모든 EJS에서 쓸 수 있게 설정
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- DB 초기화 및 더미 데이터 (30개) ---
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                nickname TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                release_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES games(id),
                user_id INTEGER REFERENCES users(id),
                content TEXT,
                score INTEGER CHECK (score >= 1 AND score <= 5),
                play_time INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(game_id, user_id)
            );
        `);

        const gameCheck = await pool.query('SELECT count(*) FROM games');
        if (parseInt(gameCheck.rows[0].count) === 0) {
            console.log("30개의 게임 데이터를 생성 중...");
            for (let i = 1; i <= 30; i++) {
                await pool.query('INSERT INTO games (title, description, release_date) VALUES ($1, $2, $3)', 
                [`명작 게임 ${i}`, `이것은 ${i}번째 게임의 상세 소개 글입니다. 정말 재미있는 게임이죠!`, new Date(Date.now() - i * 86400000)]);
            }
        }
        console.log("✅ DB 준비 완료");
    } catch (err) { console.error("❌ DB 에러:", err); }
}
initDB();

// --- 라우터 ---

// 메인: 게임 목록 (검색 + 페이징)
app.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const limit = 5;
    const offset = (page - 1) * limit;

    try {
        const queryText = `
            SELECT g.*, COALESCE(AVG(r.score), 0) as avg_rating
            FROM games g
            LEFT JOIN reviews r ON g.id = r.game_id
            WHERE g.title ILIKE $1
            GROUP BY g.id
            ORDER BY g.release_date DESC
            LIMIT $2 OFFSET $3
        `;
        const result = await pool.query(queryText, [`%${search}%`, limit, offset]);
        
        const countRes = await pool.query('SELECT COUNT(*) FROM games WHERE title ILIKE $1', [`%${search}%`]);
        const totalPages = Math.ceil(parseInt(countRes.rows[0].count) / limit);

        res.render('index', { games: result.rows, page, totalPages, search });
    } catch (err) { res.status(500).send(err.message); }
});

// 회원가입
app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', async (req, res) => {
    const { username, password, nickname } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    try {
        await pool.query('INSERT INTO users (username, password, nickname) VALUES ($1, $2, $3)', [username, hashed, nickname]);
        res.redirect('/login');
    } catch (err) { res.send("<script>alert('이미 존재하는 아이디입니다.'); history.back();</script>"); }
});

// 로그인
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0) {
        const user = result.rows[0];
        if (await bcrypt.compare(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, nickname: user.nickname };
            return res.redirect('/');
        }
    }
    res.send("<script>alert('아이디 또는 비번이 틀렸습니다.'); history.back();</script>");
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// 게임 상세 + 리뷰
app.get('/game/:id', async (req, res) => {
    if (!req.session.user) return res.send("<script>alert('로그인이 필요합니다.'); location.href='/login';</script>");
    
    try {
        const game = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
        const reviews = await pool.query(`
            SELECT r.*, u.nickname 
            FROM reviews r 
            JOIN users u ON r.user_id = u.id 
            WHERE r.game_id = $1 
            ORDER BY r.created_at DESC
        `, [req.params.id]);

        const myReview = await pool.query('SELECT * FROM reviews WHERE game_id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);

        res.render('detail', { game: game.rows[0], reviews: reviews.rows, hasReviewed: myReview.rows.length > 0 });
    } catch (err) { res.status(500).send(err.message); }
});

// 리뷰 등록
app.post('/game/:id/review', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { content, score } = req.body;
    const playTime = Math.floor(Math.random() * 200) + 1; // 1~200시간 랜덤

    try {
        await pool.query(
            'INSERT INTO reviews (game_id, user_id, content, score, play_time) VALUES ($1, $2, $3, $4, $5)',
            [req.params.id, req.session.user.id, content, score, playTime]
        );
        res.redirect(`/game/${req.params.id}`);
    } catch (err) { res.send("<script>alert('이미 리뷰를 작성하셨습니다.'); history.back();</script>"); }
});

app.listen(port, () => console.log(`🚀 Server on http://localhost:${port}`));

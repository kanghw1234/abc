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
    secret: 'steam_clone_super_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 } // 1시간
}));

// 전역 변수 설정 (EJS에서 user 사용 가능)
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- DB 초기화 및 더미 데이터 ---
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
                score INTEGER,
                play_time INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(game_id, user_id)
            );
        `);
        const gameCheck = await pool.query('SELECT count(*) FROM games');
        if (parseInt(gameCheck.rows[0].count) < 30) {
            await pool.query('DELETE FROM games'); // 초기화 후 재생성
            for (let i = 1; i <= 30; i++) {
                await pool.query('INSERT INTO games (title, description, release_date) VALUES ($1, $2, $3)', 
                [`STEAM MASTER GAME ${i}`, `이 게임은 ${i}번째 전설적인 게임입니다. 수많은 게이머들이 열광한 명작이죠.`, new Date(Date.now() - i * 3600000 * 12)]);
            }
        }
    } catch (err) { console.error(err); }
}
initDB();

// --- Routes ---

// 1. 게임 목록 (메인 페이지 - 로그인 없이 접근 가능)
app.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const limit = 5;
    const offset = (page - 1) * limit;

    try {
        // 평점 평균과 함께 최신순 정렬
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

// 2. 회원 가입
app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', async (req, res) => {
    const { username, password, nickname } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    try {
        await pool.query('INSERT INTO users (username, password, nickname) VALUES ($1, $2, $3)', [username, hashed, nickname]);
        res.redirect('/login');
    } catch (err) { res.send("<script>alert('아이디 중복!'); history.back();</script>"); }
});

// 3. 로그인
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        req.session.user = { id: result.rows[0].id, nickname: result.rows[0].nickname };
        return res.redirect('/');
    }
    res.send("<script>alert('정보 불일치!'); history.back();</script>");
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// 4. 게임 상세 조회 (로그인 필수)
app.get('/game/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    try {
        const game = await pool.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
        const reviews = await pool.query(`
            SELECT r.*, u.nickname FROM reviews r 
            JOIN users u ON r.user_id = u.id 
            WHERE r.game_id = $1 ORDER BY r.created_at DESC
        `, [req.params.id]);
        const myReview = await pool.query('SELECT * FROM reviews WHERE game_id = $1 AND user_id = $2', [req.params.id, req.session.user.id]);
        
        res.render('detail', { game: game.rows[0], reviews: reviews.rows, hasReviewed: myReview.rows.length > 0 });
    } catch (err) { res.status(500).send(err.message); }
});

// 리뷰 등록
app.post('/game/:id/review', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { content, score } = req.body;
    const playTime = Math.floor(Math.random() * 500) + 1;
    try {
        await pool.query('INSERT INTO reviews (game_id, user_id, content, score, play_time) VALUES ($1, $2, $3, $4, $5)', 
            [req.params.id, req.session.user.id, content, score, playTime]);
        res.redirect(`/game/${req.params.id}`);
    } catch (err) { res.send("<script>alert('이미 평가했습니다.'); history.back();</script>"); }
});

app.listen(port, () => console.log(`🚀 http://localhost:${port}`));

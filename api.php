<?php
/**
 * Каркыра — бэкенд сайта (PHP 7.4+, без базы данных).
 * Данные хранятся в папке data/ (защищены от прямого открытия), картинки — в uploads/.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
error_reporting(E_ALL);

const MAX_DATE = '2030-12-31';
define('DATA_DIR', __DIR__ . '/data');
define('UP_DIR', __DIR__ . '/uploads');
const GUARD = "<?php http_response_code(404); exit; ?>\n";

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/* ---------- вывод ---------- */
function out($d, int $code = 200): void {
    http_response_code($code);
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $msg, int $code = 400): void { out(['ok' => false, 'error' => $msg], $code); }

set_exception_handler(function ($e) {
    error_log('karkyra: ' . $e->getMessage());
    fail('Ошибка сервера. Попробуйте ещё раз.', 500);
});

/* ---------- хранилище ---------- */
function ensure_dirs(): void {
    foreach ([DATA_DIR, UP_DIR] as $d) { if (!is_dir($d)) @mkdir($d, 0755, true); }
    if (!is_writable(DATA_DIR) || !is_writable(UP_DIR)) {
        fail('Нет прав на запись в папки data и uploads. Выставьте для них права 755 или 775 в панели хостинга.', 500);
    }
}
function store_path(string $n): string { return DATA_DIR . '/' . $n . '.json.php'; }
function store_read(string $n, $default) {
    $p = store_path($n);
    if (!is_file($p)) return $default;
    $raw = file_get_contents($p);
    if ($raw === false) return $default;
    $d = json_decode(substr($raw, strlen(GUARD)), true);
    return $d === null ? $default : $d;
}
function store_write(string $n, $data): void {
    $p = store_path($n);
    $tmp = $p . '.tmp' . bin2hex(random_bytes(3));
    if (file_put_contents($tmp, GUARD . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) === false) {
        fail('Не удалось сохранить данные на сервере.', 500);
    }
    if (!@rename($tmp, $p)) {
        if (!@copy($tmp, $p)) { @unlink($tmp); fail('Не удалось сохранить данные на сервере.', 500); }
        @unlink($tmp);
    }
}
function locked(callable $fn) {
    $h = fopen(DATA_DIR . '/lock.dat', 'c');
    flock($h, LOCK_EX);
    $r = $fn();
    flock($h, LOCK_UN);
    fclose($h);
    return $r;
}

/* ---------- настройки ---------- */
function default_settings(): array {
    return [
        'name' => 'Каркыра',
        'tagline' => 'Забронируйте стол онлайн',
        'description' => '',
        'address' => '',
        'phone' => '',
        'phone2' => '',
        'whatsapp' => '',
        'instagram' => '',
        'map_link' => '',
        'logo' => '',
        'qr' => '',
        'qr_note' => '',
        'open' => '10:00',
        'close' => '23:00',
        'step' => 30,
        'duration' => 120,
        'deposit_with' => 1000,
        'deposit_without' => 500,
        'timezone' => 'Asia/Bishkek',
        'floors' => [
            ['name' => '1 этаж', 'rows' => [3, 3], 'capacity' => 6],
            ['name' => '2 этаж', 'rows' => [2, 4], 'capacity' => 6],
        ],
        'cabins' => ['count' => 2, 'capacity' => 12],
        'tg_token' => '',
        'tg_chat' => '',
        'password_hash' => '',
    ];
}
function settings(): array {
    return array_merge(default_settings(), store_read('settings', []));
}
function public_settings(array $s): array {
    unset($s['password_hash'], $s['tg_token'], $s['tg_chat']);
    return $s;
}
function now_dt(array $s): DateTime {
    $tz = in_array($s['timezone'], timezone_identifiers_list(), true) ? $s['timezone'] : 'Asia/Bishkek';
    return new DateTime('now', new DateTimeZone($tz));
}

/* ---------- схема зала ---------- */
function build_layout(array $s): array {
    $n = 0; $zones = [];
    foreach ($s['floors'] as $fi => $f) {
        $rows = [];
        foreach ($f['rows'] as $cnt) {
            $row = [];
            for ($i = 0; $i < $cnt; $i++) {
                $n++;
                $row[] = ['id' => 't' . $n, 'label' => 'Стол ' . $n, 'num' => $n, 'cap' => (int)$f['capacity']];
            }
            $rows[] = $row;
        }
        $zones[] = ['key' => 'f' . ($fi + 1), 'name' => $f['name'], 'type' => 'floor', 'rows' => $rows];
    }
    $c = $s['cabins'];
    if ((int)$c['count'] > 0) {
        $row = [];
        for ($i = 1; $i <= (int)$c['count']; $i++) {
            $row[] = ['id' => 'k' . $i, 'label' => 'Кабинка ' . $i, 'num' => $i, 'cap' => (int)$c['capacity']];
        }
        $zones[] = ['key' => 'cabins', 'name' => 'Кабинки', 'type' => 'cabins', 'rows' => [$row]];
    }
    return $zones;
}
function table_index(array $layout): array {
    $idx = [];
    foreach ($layout as $z) foreach ($z['rows'] as $row) foreach ($row as $t) {
        $t['zone'] = $z['name'];
        $idx[$t['id']] = $t;
    }
    return $idx;
}

/* ---------- время ---------- */
function tmin(string $t): ?int {
    if (!preg_match('/^([01]?\d|2[0-3]):([0-5]\d)$/', $t, $m)) return null;
    return (int)$m[1] * 60 + (int)$m[2];
}
function mt(int $m): string { return sprintf('%02d:%02d', intdiv($m, 60) % 24, $m % 60); }
function open_close(array $s): array {
    $o = tmin($s['open']) ?? 600;
    $c = tmin($s['close']) ?? 1380;
    if ($c === 0 || $c <= $o) $c = 1440;
    return [$o, $c];
}
function valid_date(string $d): bool {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) return false;
    [$y, $m, $dd] = array_map('intval', explode('-', $d));
    return checkdate($m, $dd, $y);
}

/* ---------- запрос ---------- */
function body(): array {
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') !== false) {
        $j = json_decode((string)file_get_contents('php://input'), true);
        return is_array($j) ? $j : [];
    }
    return $_POST;
}
function ip(): string { return substr((string)($_SERVER['REMOTE_ADDR'] ?? '0'), 0, 45); }
function str($v, int $max): string {
    $v = trim((string)$v);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $v) ?? '';
    return mb_substr($v, 0, $max);
}
function throttle_hit(string $key, int $max, int $window, bool $count = true): bool {
    return locked(function () use ($key, $max, $window, $count) {
        $t = store_read('throttle', []);
        $now = time();
        foreach ($t as $k => $arr) {
            $t[$k] = array_values(array_filter($arr, fn($x) => $x > $now - 3600));
            if (!$t[$k]) unset($t[$k]);
        }
        $arr = array_values(array_filter($t[$key] ?? [], fn($x) => $x > $now - $window));
        if (count($arr) >= $max) { store_write('throttle', $t); return false; }
        if ($count) { $arr[] = $now; $t[$key] = $arr; store_write('throttle', $t); }
        return true;
    });
}

/* ---------- картинки ---------- */
function save_image(array $f, string $prefix, int $maxBytes = 5242880): string {
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        if (($f['error'] ?? 0) === UPLOAD_ERR_INI_SIZE || ($f['error'] ?? 0) === UPLOAD_ERR_FORM_SIZE) fail('Файл слишком большой.');
        fail('Не удалось загрузить файл.');
    }
    if (!is_uploaded_file($f['tmp_name'])) fail('Не удалось загрузить файл.');
    if ($f['size'] > $maxBytes) fail('Файл слишком большой (максимум ' . intdiv($maxBytes, 1048576) . ' МБ).');
    $info = @getimagesize($f['tmp_name']);
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'][$info['mime'] ?? ''] ?? null;
    if (!$ext) fail('Допустимы только картинки JPG, PNG, WEBP или GIF.');
    $name = $prefix . '_' . bin2hex(random_bytes(8)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], UP_DIR . '/' . $name)) fail('Не удалось сохранить файл на сервере.', 500);
    @chmod(UP_DIR . '/' . $name, 0644);
    return 'uploads/' . $name;
}
function delete_upload(string $rel): void {
    if (preg_match('#^uploads/[a-z]+_[0-9a-f]{16}\.(jpg|png|webp|gif)$#', $rel)) @unlink(__DIR__ . '/' . $rel);
}

/* ---------- Telegram (по желанию) ---------- */
function tg_send(array $s, string $text): bool {
    if (empty($s['tg_token']) || empty($s['tg_chat'])) return false;
    $url = 'https://api.telegram.org/bot' . $s['tg_token'] . '/sendMessage';
    $data = http_build_query(['chat_id' => $s['tg_chat'], 'text' => $text]);
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $data, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_CONNECTTIMEOUT => 4]);
        $r = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $r !== false && $code === 200;
    }
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => 'Content-Type: application/x-www-form-urlencoded', 'content' => $data, 'timeout' => 5]]);
    return @file_get_contents($url, false, $ctx) !== false;
}

/* ---------- админ-сессия ---------- */
function admin_session(): void {
    if (session_status() !== PHP_SESSION_NONE) return;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    ini_set('session.gc_maxlifetime', '604800');
    session_name('karkyra_admin');
    session_set_cookie_params(['lifetime' => 604800, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $https]);
    session_start();
}
function require_admin(): void {
    admin_session();
    if (empty($_SESSION['admin'])) fail('Требуется вход в кабинет.', 401);
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $tok = $_SERVER['HTTP_X_CSRF'] ?? '';
        if (!isset($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $tok)) fail('Сессия устарела, обновите страницу.', 403);
    }
}

/* ---------- бронирование ---------- */
function blocking(array $b): bool { return in_array($b['status'], ['pending', 'confirmed'], true); }

function conflict_exists(array $bookings, string $table, string $date, int $s, int $e, ?string $ignoreId = null): bool {
    foreach ($bookings as $b) {
        if ($ignoreId !== null && $b['id'] === $ignoreId) continue;
        if (!blocking($b) || $b['table'] !== $table || $b['date'] !== $date) continue;
        if ($s < $b['end_m'] && $b['start_m'] < $e) return true;
    }
    return false;
}

function parse_preorder($raw, array $menu): array {
    if (is_string($raw)) $raw = json_decode($raw, true);
    if (!is_array($raw)) return [[], 0];
    $map = [];
    foreach ($menu as $cat) foreach ($cat['items'] as $it) $map[$it['id']] = $it;
    $items = []; $total = 0;
    foreach ($raw as $r) {
        $id = (string)($r['id'] ?? ''); $q = (int)($r['qty'] ?? 0);
        if (!isset($map[$id]) || $q < 1) continue;
        $q = min($q, 50);
        $items[] = ['name' => $map[$id]['name'], 'price' => $map[$id]['price'], 'qty' => $q];
        $total += $map[$id]['price'] * $q;
    }
    return [$items, $total];
}

function build_booking(array $in, array $s, bool $admin): array {
    $layout = build_layout($s); $idx = table_index($layout);
    $tid = (string)($in['table'] ?? '');
    if (!isset($idx[$tid])) fail('Стол не найден.');
    $t = $idx[$tid];
    $date = (string)($in['date'] ?? '');
    if (!valid_date($date)) fail('Выберите дату.');
    if ($date > MAX_DATE) fail('Бронь доступна до 31.12.2030.');
    $now = now_dt($s);
    if ($date < $now->format('Y-m-d')) fail('Эта дата уже прошла.');
    [$open, $close] = open_close($s);
    $start = tmin((string)($in['start'] ?? ''));
    if ($start === null) fail('Выберите время.');
    $dur = max(30, (int)$s['duration']);
    $end = $start + $dur;
    $step = max(5, (int)$s['step']);
    if ($start < $open || $end > $close || (($start - $open) % $step) !== 0) fail('Это время недоступно для брони.');
    if ($date === $now->format('Y-m-d') && $start <= (int)$now->format('G') * 60 + (int)$now->format('i')) fail('Это время уже прошло.');
    $guests = (int)($in['guests'] ?? 0);
    if ($guests < 1) fail('Укажите количество гостей.');
    if ($guests > $t['cap']) fail($t['label'] . ' рассчитан максимум на ' . $t['cap'] . ' гостей.');
    $name = str($in['name'] ?? '', 60);
    if (mb_strlen($name) < 2) fail('Введите имя.');
    $phone = str($in['phone'] ?? '', 30);
    $digits = preg_replace('/\D/', '', $phone);
    if (!$admin && (strlen($digits) < 9 || strlen($digits) > 15)) fail('Введите корректный номер телефона.');
    if ($admin && $phone !== '' && (strlen($digits) < 5 || strlen($digits) > 15)) fail('Некорректный номер телефона.');
    $menu = store_read('menu', []);
    [$pre, $preTotal] = parse_preorder($in['preorder'] ?? '[]', $menu);
    $has = count($pre) > 0;
    return [
        'table' => $tid, 'table_label' => $t['label'], 'zone' => $t['zone'],
        'date' => $date, 'start' => mt($start), 'end' => mt($end), 'start_m' => $start, 'end_m' => $end,
        'guests' => $guests, 'name' => $name, 'phone' => $phone,
        'comment' => str($in['comment'] ?? '', 500),
        'preorder' => $pre, 'preorder_total' => $preTotal, 'has_preorder' => $has,
        'deposit' => $has ? (int)$s['deposit_with'] : (int)$s['deposit_without'],
    ];
}

function public_booking(array $b): array {
    return [
        'id' => $b['id'], 'status' => $b['status'], 'table_label' => $b['table_label'], 'zone' => $b['zone'],
        'date' => $b['date'], 'start' => $b['start'], 'end' => $b['end'], 'guests' => $b['guests'],
        'deposit' => $b['deposit'], 'has_preorder' => $b['has_preorder'], 'name' => $b['name'],
    ];
}

/* ---------- маршрутизация ---------- */
ensure_dirs();
$action = (string)($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

switch ($action) {

    case 'public': {
        $s = settings();
        $now = now_dt($s);
        [$open, $close] = open_close($s);
        out([
            'ok' => true,
            'settings' => public_settings($s),
            'layout' => build_layout($s),
            'menu' => store_read('menu', []),
            'now' => ['date' => $now->format('Y-m-d'), 'min' => (int)$now->format('G') * 60 + (int)$now->format('i')],
            'max_date' => MAX_DATE, 'open_m' => $open, 'close_m' => $close,
        ]);
    }

    case 'day': {
        $date = (string)($_GET['date'] ?? '');
        if (!valid_date($date)) fail('Неверная дата.');
        $busy = [];
        foreach (store_read('bookings', []) as $b) {
            if ($b['date'] === $date && blocking($b)) $busy[] = ['table' => $b['table'], 's' => $b['start_m'], 'e' => $b['end_m']];
        }
        out(['ok' => true, 'busy' => $busy]);
    }

    case 'status': {
        $ids = array_filter(array_map('trim', explode(',', (string)($_GET['ids'] ?? ''))), fn($x) => preg_match('/^[0-9a-f]{12}$/', $x));
        $ids = array_slice(array_values($ids), 0, 30);
        $res = [];
        foreach (store_read('bookings', []) as $b) if (in_array($b['id'], $ids, true)) $res[] = public_booking($b);
        out(['ok' => true, 'bookings' => $res]);
    }

    case 'book': {
        if ($method !== 'POST') fail('Метод не поддерживается.', 405);
        $in = body();
        if (!empty($in['website'])) out(['ok' => true]); // ловушка для ботов
        if (!throttle_hit('book:' . ip(), 15, 3600, false)) fail('Слишком много заявок. Попробуйте позже или позвоните нам.', 429);
        $s = settings();
        $b = build_booking($in, $s, false);
        $receipt = '';
        if (!empty($_FILES['receipt']) && ($_FILES['receipt']['error'] ?? 4) !== UPLOAD_ERR_NO_FILE) $receipt = save_image($_FILES['receipt'], 'receipt');
        $result = locked(function () use ($b, $receipt) {
            $all = store_read('bookings', []);
            if (conflict_exists($all, $b['table'], $b['date'], $b['start_m'], $b['end_m'])) return null;
            $digits = preg_replace('/\D/', '', $b['phone']);
            $active = 0;
            foreach ($all as $x) if (blocking($x) && $x['date'] >= date('Y-m-d', time() - 86400) && preg_replace('/\D/', '', $x['phone']) === $digits) $active++;
            if ($active >= 4) return false;
            $b += [
                'id' => bin2hex(random_bytes(6)), 'created_at' => date('c'), 'status' => 'pending',
                'paid' => false, 'receipt' => $receipt, 'source' => 'site', 'admin_note' => '',
            ];
            $all[] = $b;
            store_write('bookings', $all);
            return $b;
        });
        if ($result === null) { if ($receipt) delete_upload($receipt); fail('К сожалению, этот стол на выбранное время уже занят. Выберите другое время или стол.', 409); }
        if ($result === false) { if ($receipt) delete_upload($receipt); fail('На этот номер уже оформлено максимальное число активных броней.', 429); }
        throttle_hit('book:' . ip(), 15, 3600, true);
        echo json_encode(['ok' => true, 'booking' => public_booking($result)], JSON_UNESCAPED_UNICODE);
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        $d = DateTime::createFromFormat('Y-m-d', $result['date']);
        tg_send($s, "🔔 Новая заявка на бронь\n{$result['table_label']} ({$result['zone']})\n" . $d->format('d.m.Y') . " {$result['start']}–{$result['end']}, гостей: {$result['guests']}\n{$result['name']}, {$result['phone']}\nЗадаток: {$result['deposit']} сом" . ($result['has_preorder'] ? " (с предзаказом)" : ""));
        exit;
    }

    /* ----- вход / настройка пароля ----- */
    case 'me': {
        admin_session();
        $s = settings();
        if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
        out(['ok' => true, 'setup_needed' => $s['password_hash'] === '', 'auth' => !empty($_SESSION['admin']), 'csrf' => !empty($_SESSION['admin']) ? $_SESSION['csrf'] : '']);
    }

    case 'setup': {
        if ($method !== 'POST') fail('Метод не поддерживается.', 405);
        admin_session();
        $in = body();
        $res = locked(function () use ($in) {
            $s = settings();
            if ($s['password_hash'] !== '') return 'exists';
            $pw = (string)($in['password'] ?? '');
            if (mb_strlen($pw) < 6) return 'short';
            $s['password_hash'] = password_hash($pw, PASSWORD_DEFAULT);
            store_write('settings', $s);
            return 'ok';
        });
        if ($res === 'exists') fail('Пароль уже задан.');
        if ($res === 'short') fail('Пароль должен быть не короче 6 символов.');
        session_regenerate_id(true);
        $_SESSION['admin'] = true; $_SESSION['csrf'] = bin2hex(random_bytes(16));
        out(['ok' => true, 'csrf' => $_SESSION['csrf']]);
    }

    case 'login': {
        if ($method !== 'POST') fail('Метод не поддерживается.', 405);
        admin_session();
        if (!throttle_hit('login:' . ip(), 8, 900, false)) fail('Слишком много попыток входа. Подождите 15 минут.', 429);
        $in = body(); $s = settings();
        if ($s['password_hash'] === '' || !password_verify((string)($in['password'] ?? ''), $s['password_hash'])) {
            throttle_hit('login:' . ip(), 8, 900, true);
            usleep(600000);
            fail('Неверный пароль.', 401);
        }
        session_regenerate_id(true);
        $_SESSION['admin'] = true; $_SESSION['csrf'] = bin2hex(random_bytes(16));
        out(['ok' => true, 'csrf' => $_SESSION['csrf']]);
    }

    case 'logout': {
        admin_session();
        $_SESSION = [];
        session_destroy();
        out(['ok' => true]);
    }

    /* ----- админ: заявки ----- */
    case 'admin_bookings': {
        require_admin();
        $s = settings(); $now = now_dt($s);
        $all = store_read('bookings', []);
        usort($all, fn($a, $b) => [$a['date'], $a['start_m']] <=> [$b['date'], $b['start_m']]);
        out(['ok' => true, 'bookings' => $all, 'today' => $now->format('Y-m-d'), 'now_min' => (int)$now->format('G') * 60 + (int)$now->format('i')]);
    }

    case 'booking_update': {
        require_admin();
        $in = body(); $id = (string)($in['id'] ?? '');
        $res = locked(function () use ($in, $id) {
            $all = store_read('bookings', []);
            foreach ($all as $i => $b) {
                if ($b['id'] !== $id) continue;
                if (isset($in['status'])) {
                    $st = (string)$in['status'];
                    if (!in_array($st, ['pending', 'confirmed', 'rejected', 'cancelled'], true)) return 'bad';
                    if (in_array($st, ['pending', 'confirmed'], true) && !blocking($b)
                        && conflict_exists($all, $b['table'], $b['date'], $b['start_m'], $b['end_m'], $id)) return 'conflict';
                    $all[$i]['status'] = $st;
                }
                if (isset($in['paid'])) $all[$i]['paid'] = (bool)$in['paid'];
                if (isset($in['admin_note'])) $all[$i]['admin_note'] = str($in['admin_note'], 300);
                store_write('bookings', $all);
                return 'ok';
            }
            return 'none';
        });
        if ($res === 'none') fail('Бронь не найдена.', 404);
        if ($res === 'bad') fail('Неверный статус.');
        if ($res === 'conflict') fail('Этот стол в это время уже занят другой бронью.', 409);
        out(['ok' => true]);
    }

    case 'booking_delete': {
        require_admin();
        $id = (string)(body()['id'] ?? '');
        locked(function () use ($id) {
            $all = store_read('bookings', []); $keep = [];
            foreach ($all as $b) { if ($b['id'] === $id) { if (!empty($b['receipt'])) delete_upload($b['receipt']); } else $keep[] = $b; }
            store_write('bookings', $keep);
        });
        out(['ok' => true]);
    }

    case 'booking_create': {
        require_admin();
        $s = settings();
        $b = build_booking(body(), $s, true);
        $in = body();
        $res = locked(function () use ($b, $in) {
            $all = store_read('bookings', []);
            if (conflict_exists($all, $b['table'], $b['date'], $b['start_m'], $b['end_m'])) return null;
            $b += ['id' => bin2hex(random_bytes(6)), 'created_at' => date('c'), 'status' => 'confirmed', 'paid' => !empty($in['paid']),
                   'receipt' => '', 'source' => 'admin', 'admin_note' => ''];
            $all[] = $b; store_write('bookings', $all);
            return $b;
        });
        if ($res === null) fail('Этот стол в это время уже занят.', 409);
        out(['ok' => true]);
    }

    /* ----- админ: меню ----- */
    case 'menu_save': {
        require_admin();
        $raw = body()['menu'] ?? [];
        if (!is_array($raw)) fail('Неверные данные меню.');
        $clean = []; $used = [];
        $mkid = function ($id) use (&$used) {
            $id = preg_replace('/[^A-Za-z0-9_-]/', '', (string)$id);
            if ($id === '' || strlen($id) > 24 || isset($used[$id])) $id = bin2hex(random_bytes(5));
            $used[$id] = 1; return $id;
        };
        foreach (array_slice($raw, 0, 60) as $c) {
            if (!is_array($c)) continue;
            $items = [];
            foreach (array_slice($c['items'] ?? [], 0, 300) as $it) {
                if (!is_array($it)) continue;
                $price = (float)($it['price'] ?? 0);
                $items[] = ['id' => $mkid($it['id'] ?? ''), 'name' => str($it['name'] ?? '', 100), 'price' => (int)round(max(0, min(1000000, $price)))];
            }
            $clean[] = ['id' => $mkid($c['id'] ?? ''), 'name' => str($c['name'] ?? '', 60), 'items' => $items];
        }
        locked(fn() => store_write('menu', $clean));
        out(['ok' => true, 'menu' => $clean]);
    }

    /* ----- админ: настройки ----- */
    case 'settings_get': {
        require_admin();
        $s = settings(); unset($s['password_hash']);
        out(['ok' => true, 'settings' => $s, 'timezones' => ['Asia/Bishkek', 'Asia/Almaty', 'Asia/Tashkent', 'Europe/Moscow', 'Asia/Dubai']]);
    }

    case 'settings_save': {
        require_admin();
        $in = body();
        $res = locked(function () use ($in) {
            $s = settings();
            foreach (['name' => 40, 'tagline' => 120, 'description' => 500, 'address' => 200, 'phone' => 40, 'phone2' => 40,
                      'whatsapp' => 40, 'instagram' => 150, 'map_link' => 300, 'qr_note' => 300, 'tg_token' => 80, 'tg_chat' => 40] as $k => $max) {
                if (array_key_exists($k, $in)) $s[$k] = str($in[$k], $max);
            }
            if (trim($s['name']) === '') $s['name'] = 'Каркыра';
            foreach (['map_link', 'instagram'] as $k) {
                if ($s[$k] !== '' && !preg_match('#^https?://#i', $s[$k]) && $k === 'map_link') $s[$k] = 'https://' . $s[$k];
            }
            $o = tmin((string)($in['open'] ?? $s['open'])); $c = tmin((string)($in['close'] ?? $s['close']));
            if ($o === null || $c === null) return 'Неверное время работы.';
            if ($c === 0) $c = 1440;
            if ($c <= $o) return 'Время закрытия должно быть позже времени открытия (до 00:00 включительно).';
            $s['open'] = mt($o); $s['close'] = mt($c);
            $s['step'] = in_array((int)($in['step'] ?? $s['step']), [15, 30, 60], true) ? (int)($in['step'] ?? $s['step']) : 30;
            $s['duration'] = max(30, min(480, (int)($in['duration'] ?? $s['duration'])));
            if ($o + $s['duration'] > $c) return 'Длительность брони больше времени работы кафе.';
            $s['deposit_with'] = max(0, min(1000000, (int)($in['deposit_with'] ?? $s['deposit_with'])));
            $s['deposit_without'] = max(0, min(1000000, (int)($in['deposit_without'] ?? $s['deposit_without'])));
            $tz = (string)($in['timezone'] ?? $s['timezone']);
            if (in_array($tz, timezone_identifiers_list(), true)) $s['timezone'] = $tz;
            if (isset($in['floors']) && is_array($in['floors'])) {
                $fl = [];
                foreach (array_slice($in['floors'], 0, 4) as $i => $f) {
                    $rows = [];
                    foreach (preg_split('/[^0-9]+/', (string)($f['rows'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $r) { $r = (int)$r; if ($r >= 1 && $r <= 12) $rows[] = $r; }
                    $rows = array_slice($rows, 0, 8);
                    if (!$rows) return 'Укажите количество столов в рядах этажа, например: 3,3';
                    $fl[] = ['name' => str($f['name'] ?? ('Этаж ' . ($i + 1)), 30) ?: ('Этаж ' . ($i + 1)), 'rows' => $rows, 'capacity' => max(1, min(30, (int)($f['capacity'] ?? 6)))];
                }
                if ($fl) $s['floors'] = $fl;
            }
            if (isset($in['cabins']) && is_array($in['cabins'])) {
                $s['cabins'] = ['count' => max(0, min(10, (int)($in['cabins']['count'] ?? 0))), 'capacity' => max(1, min(40, (int)($in['cabins']['capacity'] ?? 12)))];
            }
            store_write('settings', $s);
            return true;
        });
        if ($res !== true) fail((string)$res);
        out(['ok' => true]);
    }

    case 'upload_image': {
        require_admin();
        $kind = (string)($_POST['kind'] ?? '');
        if (!in_array($kind, ['logo', 'qr'], true)) fail('Неверный тип файла.');
        if (empty($_FILES['file'])) fail('Файл не выбран.');
        $path = save_image($_FILES['file'], $kind, 4194304);
        locked(function () use ($kind, $path) {
            $s = settings();
            if ($s[$kind]) delete_upload($s[$kind]);
            $s[$kind] = $path; store_write('settings', $s);
        });
        out(['ok' => true, 'path' => $path]);
    }

    case 'remove_image': {
        require_admin();
        $kind = (string)(body()['kind'] ?? '');
        if (!in_array($kind, ['logo', 'qr'], true)) fail('Неверный тип файла.');
        locked(function () use ($kind) {
            $s = settings();
            if ($s[$kind]) delete_upload($s[$kind]);
            $s[$kind] = ''; store_write('settings', $s);
        });
        out(['ok' => true]);
    }

    case 'password_change': {
        require_admin();
        $in = body();
        $res = locked(function () use ($in) {
            $s = settings();
            if (!password_verify((string)($in['old'] ?? ''), $s['password_hash'])) return 'Текущий пароль неверный.';
            $new = (string)($in['new'] ?? '');
            if (mb_strlen($new) < 6) return 'Новый пароль должен быть не короче 6 символов.';
            $s['password_hash'] = password_hash($new, PASSWORD_DEFAULT);
            store_write('settings', $s);
            return true;
        });
        if ($res !== true) fail((string)$res);
        out(['ok' => true]);
    }

    case 'tg_test': {
        require_admin();
        $s = settings();
        $in = body();
        if (!empty($in['tg_token'])) $s['tg_token'] = str($in['tg_token'], 80);
        if (!empty($in['tg_chat'])) $s['tg_chat'] = str($in['tg_chat'], 40);
        if (!tg_send($s, '✅ Каркыра: уведомления о бронях подключены.')) fail('Не удалось отправить. Проверьте токен бота и chat id (и что вы нажали Start у бота).');
        out(['ok' => true]);
    }

    default:
        fail('Неизвестное действие.', 404);
}

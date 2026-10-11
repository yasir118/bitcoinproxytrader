<?php
/** Database connection. Reads collector/config.local.json (same file the Python collector uses) -> falls back to XAMPP defaults. */
declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $cfg = ['host' => '127.0.0.1', 'port' => 3306, 'user' => 'root', 'password' => '', 'name' => 'mstr_terminal'];
    $file = __DIR__ . '/../collector/config.local.json';
    if (is_file($file)) {
        $j = json_decode((string)file_get_contents($file), true);
        if (!empty($j['db']) && is_array($j['db'])) {
            $cfg = array_merge($cfg, $j['db']);
        }
    }
    $dsn = "mysql:host={$cfg['host']};port={$cfg['port']};dbname={$cfg['name']};charset=utf8mb4";
    $pdo = new PDO($dsn, $cfg['user'], (string)$cfg['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => true,
    ]);
    return $pdo;
}

// Тесты проверяют исходный механизм лицензий. В сборке форка Pro включён без
// ключа; здесь возвращаем проверку ключа (см. proUnlocked в services/settings.ts).
process.env.PAPERWEIGHT_REQUIRE_LICENSE = "1";

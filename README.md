# SIRENE French Business Registry Pipeline & Geospatial Analytics

Высокопроизводительный аналитический пайплайн и геопространственный слой на базе официальных датасетов **INSEE** (реестр предприятий SIRENE) и данных геолокации Франции.

---

## Архитектурные принципы

1. **Динамический Discovery через API:** Ссылки на ежемесячные выгрузки INSEE формируются с датами публикации (например, `20260901-090503`). Пайплайн автоматически опрашивает API `data.gouv.fr`, находит свежие Parquet-файлы и валидирует их размер и контрольные суммы.
2. **Только Parquet (CSV deprecated):** Прямая поддержка высокоэффективного формата Apache Parquet с компрессией ZSTD.
3. **DuckDB In-Memory & Out-of-Core Processing:** Быстрая потоковая обработка 35+ млн записей на 16 потоках CPU с контролем памяти.
4. **Фильтрация на входе:** Отсечение закрытых предприятий (`etatAdministratifEtablissement = 'A'`) до построения аналитических срезов.
5. **Двойная геометрия (WGS84 + Lambert 93):** Сохранение точных геодезических координат INSEE (RGF93 / EPSG:2154 для метрополии и региональные EPSG для заморских территорий) вместе с готовыми GPS-координатами WGS84 (`EPSG:4326`).
6. **Milestone 6 (Измеримый результат):** Построение сводки распределения заведений по 101 департаменту Франции и кодам экономической деятельности NAF/APE.

---

## Быстрый старт

### 1. Установка зависимостей
```bash
python -m pip install -r requirements.txt
```

### 2. Команды интерфейса управления (`run.py`)

- **Проверить наличие свежих датасетов на data.gouv.fr:**
  ```bash
  python run.py discover
  ```

- **Быстрый сквозной тест на удалённых данных (без скачивания 3 ГБ):**
  ```bash
  python run.py sample --limit 25000
  ```

- **Скачать полные Parquet-датасеты (с докачкой и SHA1):**
  ```bash
  python run.py download
  ```

- **Выполнить ETL-обработку и гео-джойн:**
  ```bash
  python run.py process
  ```

- **Рассчитать сводку NAF x Департамент (Milestone 6):**
  ```bash
  python run.py analyze
  ```
  *Опционально с фильтром по конкретным кодам NAF:*
  ```bash
  python run.py analyze --naf "56.10A,62.01Z,47.11D"
  ```

- **Запустить интерактивный веб-дашборд (карта, фильтры, 101 департамент):**
  ```bash
  python run.py serve
  # Или двойной клик по start_dashboard.bat в проводнике Windows
  ```
  Откроется в браузере: `http://localhost:8000`

- **Выполнить всё сквозным циклом:**
  ```bash
  python run.py all
  ```

---

## Структура проекта

```
SIRENE/
├── .agents/              # Агентные скилы (brainstorming, ui-ux-pro-max, etc.)
├── src/
│   ├── config.py         # Настройки путей, API slugs, проекции CRS
│   ├── fetcher.py        # API Discovery и загрузчик с докачкой
│   ├── pipeline.py       # DuckDB ETL: фильтрация и гео-джойн
│   └── analytics.py      # Агрегатор NAF x Департамент (Milestone 6)
├── data/
│   ├── raw/              # Исходные Parquet INSEE (~3 ГБ)
│   └── processed/        # Очищенный слой active_establishments_geo.parquet
├── output/               # Итоговые отчёты CSV и JSON
├── requirements.txt      # Зависимости Python
├── run.py                # Консольная точка входа
└── sirene_task.md        # Исходные требования и спецификация
```

---

## Результаты Milestone 6

Аналитический модуль формирует в папке `output/`:
- `sirene_summary_naf_departement.csv` — полная матрица распределения по департаментам и отраслям;
- `sirene_summary_top_naf.csv` — рейтинг отраслей по объёму действующих предприятий во Франции;
- `sirene_summary_departements.csv` — статистика по всем департаментам с процентом успешного геокодирования;
- `sirene_milestone6_report.json` — структурированные метаданные и метрики.

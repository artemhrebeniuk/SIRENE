Table of Contents 

# **L0. Где скачать SIRENE и что с ней делать** 

Дата проверки ссылок: 2026-09-07. Всё ниже —  с официальных страниц data.gouv.fr, ничего не додумано. 

## **Главное, что надо понять до скачивания** 

**Файлов два,  и они разные.** В основной базе SIRENE **нет координат** . Геолокализация публикуется INSEE отдельным файлом. Соединяются по SIRET. 

||Что внутри|Чего нет|
|---|---|---|
|**StockEtablissement**|SIRET,<br>,<br>название адрес<br>,<br>NAF/APE,<br>строкой код<br>,<br>дата создания статус<br>(<br>/<br>действующее закрыто<br>)<br>е|координат|
|**Fichier géolocalisation**<br>**établissements**|SIRET,<br>X/Y,<br>координаты<br>,<br>код коммуны качество<br>,<br>геокодирования<br>IRIS/QPV<br>привязка к|, NAF,<br>названий<br>адреса|



Ни в одном из них нет **email, телефона и сайта** . Контакты — это уровень L4, отдельная задача. 

## **Ссылки для скачивания** 

### **1. StockEtablissement — все заведения Франции** 

Датасет: Base Sirene des entreprises et de leurs établissements (SIREN, SIRET) Издатель: INSEE. Обновление: ежемесячно, файл выкладывается с  1-го числа и отражает состояние реестра на последний день предыдущего месяца. 

- **Parquet, 2,21 ГБ** (брать этот): https://static.data.gouv.fr/resources/base-sirenedes-entreprises-et-de-leurs-etablissements-siren-siret/20260901-090503/stockstocketablissement-parquet.parquet 

- CSV  ZIP, 2,87 в ГБ: https://static.data.gouv.fr/resources/base-sirene-des-entrepriseset-de-leurs-etablissements-siren-siret/20260901-084016/stock-stocketablissementcsv.zip 

Ссылки содержат дату сборки (20260901-…) — то есть на каждый месяц URL свой. Хардкодить нельзя: брать текущий ресурс через API data.gouv (/api/1/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret/) и парсить список ресурсов. 

### **2. Файл геолокализации** 

Датасет: Géolocalisation des établissements du répertoire Sirene pour les études statistiques Издатель: INSEE. Версия от 21 августа 2026, обновляется в конце каждого месяца. 

- **Parquet, 771 МБ** (брать этот): https://static.data.gouv.fr/resources/geolocalisation-des-etablissements-durepertoire-sirene-pour-les-etudes-statistiques/20260821-081708/geolocgeolocalisationetablissement-sirene-pour-etudes-statistiques-parquet.parquet 

- CSV  ZIP, 1,1 в ГБ: https://static.data.gouv.fr/resources/geolocalisation-desetablissements-du-repertoire-sirene-pour-les-etudes-statistiques/20260821081434/geoloc-geolocalisationetablissement-sirene-pour-etudes-statistiques-csv.zip 

- • **Документация полей, PDF** (обязательно к прочтению перед загрузкой): https://static.data.gouv.fr/resources/geolocalisation-desetablissements-du-repertoire-sirene-pour-les-etudes-statistiques/20260123143212/documentation-geolocalisationetablissements-sirenepouretudesstatistiques-v8.pdf 

### **3. API Recherche d’entreprises — для точечных проверок** 

Документация — бесплатный, без ключа. Для выгрузки всей базы не годится, для проверки отдельной карточки — да. 

## **Что важно знать про эти файлы** 

**CSV уходит.** INSEE переводит публикацию на parquet, CSV прекращается в  2027. Писать загрузчик сразу под parquet. 

**Покрытие геофайла** — вся Франция кроме Майотты (метрополия + DOM), **с разными системами координат для разных территорий** . Для пилота во Франции метрополии это неважно, но при загрузке в  PostGIS проекцию надо задавать явно,  а не по умолчанию. Точные CRS —  PDF-в документации. **Старая база Etalab больше не актуальна.** Геокодированная SIRENE, которую делал Etalab (та, что через BAN), **декоммиссирована в апреле 2026** в пользу файла самого INSEE. Гуглить будет старые статьи с той ссылкой — не брать. 

**Лицензия — расхождение в метаданных.** На странице датасета указана Licence Ouverte 2.0,   API-а в метаданных того же датасета — ODbL. Разница существенная: ODbL требует share-alike, Licence Ouverte — нет. Для коммерческого продукта это надо уточнить,  а не решать по догадке. Файл геолокализации — однозначно Licence Ouverte 2.0. 

## **Порядок действий Артёма** 

1. Скачать оба parquet (≈3 ГБ суммарно). 

2. Поднять PostgreSQL + PostGIS. 

3. Загрузить StockEtablissement, отфильтровав на входе: только действующие заведения. Полная таблица — десятки миллионов строк, тащить всё в базу незачем. 

4. Загрузить геофайл, сджойнить по SIRET, собрать геометрию точки с явно заданной проекцией. 

5. Приложить фильтр по кодам NAF. 6. Отдать сводку: сколько заведений по каждому коду NAF  и по каждому департаменту. 

Пункт 6 — первый измеримый результат проекта. До него никакие решения о пилотной зоне принимать не на чем. 

**Блокер прежний:** списка кодов NAF нет. Пункты 1–4 от него не зависят и делаются уже сейчас. 

## **Разметка источников** 

**(а)  С первоисточников:** имена датасетов, издатель (INSEE), прямые URL ресурсов, форматы и размеры файлов, даты обновления, периодичность публикации, переход на parquet  с прекращением CSV  2027, в покрытие (кроме Майотты)  и разные CRS, декоммиссия датасета Etalab  в апреле 2026, расхождение по лицензии между страницей и  API-метаданными, состав полей на уровне «что в каком файле». 

**(б) Моё:** порядок действий 1–6, рекомендация брать parquet, рекомендация не хардкодить URL  и ходить через API, требование явно задавать проекцию, вывод что пункт 6 — первая точка принятия решений. 

**Чего не проверял:** точные имена колонок в обоих файлах (они в  PDFдокументации,  я её не открывал); фактическое число строк после фильтрации. 


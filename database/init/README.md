This directory is mounted into the PostgreSQL container at /docker-entrypoint-initdb.d in docker-compose.

Place optional .sql or .sh initialization scripts here to seed or configure the database on first boot.

It is intentionally left empty so the bind mount path exists.


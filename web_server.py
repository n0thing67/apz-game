==> Downloading cache...
==> Cloning from https://github.com/n0thing67/apz-game
==> Checking out commit 6c5254c7a5ada628be3c92869f020ed4f5853cd8 in branch main
==> Downloaded 106MB in 2s. Extraction took 2s.
==> Installing Python version 3.13.4...
==> Using Python version 3.13.4 (default)
==> Docs on specifying a Python version: https://render.com/docs/python-version
==> Using Poetry version 2.1.3 (default)
==> Docs on specifying a Poetry version: https://render.com/docs/poetry-version
==> Running build command 'pip install -r requirements.txt'...
Collecting aiogram>=3.0 (from -r requirements.txt (line 1))
  Using cached aiogram-3.24.0-py3-none-any.whl.metadata (6.7 kB)
Collecting aiosqlite>=0.19 (from -r requirements.txt (line 2))
  Using cached aiosqlite-0.22.1-py3-none-any.whl.metadata (4.3 kB)
Collecting python-dotenv>=1.0 (from -r requirements.txt (line 3))
  Using cached python_dotenv-1.2.1-py3-none-any.whl.metadata (25 kB)
Collecting aiohttp>=3.9 (from -r requirements.txt (line 4))
  Using cached aiohttp-3.13.3-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl.metadata (8.1 kB)
Collecting Pillow>=10.0 (from -r requirements.txt (line 5))
  Using cached pillow-12.1.0-cp313-cp313-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl.metadata (8.8 kB)
Collecting psycopg2-binary (from -r requirements.txt (line 6))
  Using cached psycopg2_binary-2.9.11-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.whl.metadata (4.9 kB)
Collecting asyncpg>=0.29 (from -r requirements.txt (line 7))
  Using cached asyncpg-0.31.0-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl.metadata (4.4 kB)
Collecting aiofiles<26.0,>=23.2.1 (from aiogram>=3.0->-r requirements.txt (line 1))
  Using cached aiofiles-25.1.0-py3-none-any.whl.metadata (6.3 kB)
Collecting certifi>=2023.7.22 (from aiogram>=3.0->-r requirements.txt (line 1))
  Using cached certifi-2026.1.4-py3-none-any.whl.metadata (2.5 kB)
Collecting magic-filter<1.1,>=1.0.12 (from aiogram>=3.0->-r requirements.txt (line 1))
  Using cached magic_filter-1.0.12-py3-none-any.whl.metadata (1.5 kB)
Collecting pydantic<2.13,>=2.4.1 (from aiogram>=3.0->-r requirements.txt (line 1))
  Using cached pydantic-2.12.5-py3-none-any.whl.metadata (90 kB)
Collecting typing-extensions<=5.0,>=4.7.0 (from aiogram>=3.0->-r requirements.txt (line 1))
  Using cached typing_extensions-4.15.0-py3-none-any.whl.metadata (3.3 kB)
Collecting aiohappyeyeballs>=2.5.0 (from aiohttp>=3.9->-r requirements.txt (line 4))
  Using cached aiohappyeyeballs-2.6.1-py3-none-any.whl.metadata (5.9 kB)
Collecting aiosignal>=1.4.0 (from aiohttp>=3.9->-r requirements.txt (line 4))
  Using cached aiosignal-1.4.0-py3-none-any.whl.metadata (3.7 kB)
Collecting attrs>=17.3.0 (from aiohttp>=3.9->-r requirements.txt (line 4))
  Using cached attrs-25.4.0-py3-none-any.whl.metadata (10 kB)
Collecting frozenlist>=1.1.1 (from aiohttp>=3.9->-r requirements.txt (line 4))
  Using cached frozenlist-1.8.0-cp313-cp313-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl.metadata (20 kB)
Collecting multidict<7.0,>=4.5 (from aiohttp>=3.9->-r requirements.txt (line 4))
  Using cached multidict-6.7.1-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl.metadata (5.3 kB)
Collecting propcache>=0.2.0 (from aiohttp>=3.9->-r requirements.txt (line 4))
  Using cached propcache-0.4.1-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl.metadata (13 kB)
Collecting yarl<2.0,>=1.17.0 (from aiohttp>=3.9->-r requirements.txt (line 4))
  Using cached yarl-1.22.0-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl.metadata (75 kB)
Collecting annotated-types>=0.6.0 (from pydantic<2.13,>=2.4.1->aiogram>=3.0->-r requirements.txt (line 1))
  Using cached annotated_types-0.7.0-py3-none-any.whl.metadata (15 kB)
Collecting pydantic-core==2.41.5 (from pydantic<2.13,>=2.4.1->aiogram>=3.0->-r requirements.txt (line 1))
  Using cached pydantic_core-2.41.5-cp313-cp313-manylinux_2_17_x86_64.manylinux2014_x86_64.whl.metadata (7.3 kB)
Collecting typing-inspection>=0.4.2 (from pydantic<2.13,>=2.4.1->aiogram>=3.0->-r requirements.txt (line 1))
  Using cached typing_inspection-0.4.2-py3-none-any.whl.metadata (2.6 kB)
Collecting idna>=2.0 (from yarl<2.0,>=1.17.0->aiohttp>=3.9->-r requirements.txt (line 4))
  Using cached idna-3.11-py3-none-any.whl.metadata (8.4 kB)
Using cached aiogram-3.24.0-py3-none-any.whl (706 kB)
Using cached aiohttp-3.13.3-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl (1.7 MB)
Using cached aiofiles-25.1.0-py3-none-any.whl (14 kB)
Using cached magic_filter-1.0.12-py3-none-any.whl (11 kB)
Using cached multidict-6.7.1-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl (254 kB)
Using cached pydantic-2.12.5-py3-none-any.whl (463 kB)
Using cached pydantic_core-2.41.5-cp313-cp313-manylinux_2_17_x86_64.manylinux2014_x86_64.whl (2.1 MB)
Using cached typing_extensions-4.15.0-py3-none-any.whl (44 kB)
Using cached yarl-1.22.0-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl (377 kB)
Using cached aiosqlite-0.22.1-py3-none-any.whl (17 kB)
Using cached python_dotenv-1.2.1-py3-none-any.whl (21 kB)
Using cached pillow-12.1.0-cp313-cp313-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl (7.0 MB)
Using cached psycopg2_binary-2.9.11-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.whl (4.2 MB)
Using cached asyncpg-0.31.0-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl (3.5 MB)
Using cached aiohappyeyeballs-2.6.1-py3-none-any.whl (15 kB)
Using cached aiosignal-1.4.0-py3-none-any.whl (7.5 kB)
Using cached annotated_types-0.7.0-py3-none-any.whl (13 kB)
Using cached attrs-25.4.0-py3-none-any.whl (67 kB)
Using cached certifi-2026.1.4-py3-none-any.whl (152 kB)
Using cached frozenlist-1.8.0-cp313-cp313-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl (234 kB)
Using cached idna-3.11-py3-none-any.whl (71 kB)
Using cached propcache-0.4.1-cp313-cp313-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl (204 kB)
Using cached typing_inspection-0.4.2-py3-none-any.whl (14 kB)
Installing collected packages: typing-extensions, python-dotenv, psycopg2-binary, propcache, Pillow, multidict, magic-filter, idna, frozenlist, certifi, attrs, asyncpg, annotated-types, aiosqlite, aiohappyeyeballs, aiofiles, yarl, typing-inspection, pydantic-core, aiosignal, pydantic, aiohttp, aiogram
Successfully installed Pillow-12.1.0 aiofiles-25.1.0 aiogram-3.24.0 aiohappyeyeballs-2.6.1 aiohttp-3.13.3 aiosignal-1.4.0 aiosqlite-0.22.1 annotated-types-0.7.0 asyncpg-0.31.0 attrs-25.4.0 certifi-2026.1.4 frozenlist-1.8.0 idna-3.11 magic-filter-1.0.12 multidict-6.7.1 propcache-0.4.1 psycopg2-binary-2.9.11 pydantic-2.12.5 pydantic-core-2.41.5 python-dotenv-1.2.1 typing-extensions-4.15.0 typing-inspection-0.4.2 yarl-1.22.0
[notice] A new release of pip is available: 25.1.1 -> 26.0
[notice] To update, run: pip install --upgrade pip
==> Uploading build...
==> Uploaded in 11.8s. Compression took 6.8s
==> Build successful 🎉
==> Deploying...
==> Setting WEB_CONCURRENCY=1 by default, based on available CPUs in the instance
==> Running 'python bot.py'
Traceback (most recent call last):
  File "/opt/render/project/src/bot.py", line 41, in <module>
    asyncio.run(main())
    ~~~~~~~~~~~^^^^^^^^
  File "/opt/render/project/python/Python-3.13.4/lib/python3.13/asyncio/runners.py", line 195, in run
    return runner.run(main)
           ~~~~~~~~~~^^^^^^
  File "/opt/render/project/python/Python-3.13.4/lib/python3.13/asyncio/runners.py", line 118, in run
    return self._loop.run_until_complete(task)
           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^^^^^^
  File "/opt/render/project/python/Python-3.13.4/lib/python3.13/asyncio/base_events.py", line 725, in run_until_complete
    return future.result()
           ~~~~~~~~~~~~~^^
  File "/opt/render/project/src/bot.py", line 19, in main
    await create_table()
  File "/opt/render/project/src/database/db.py", line 279, in create_table
    pool = await get_db()
           ^^^^^^^^^^^^^^
  File "/opt/render/project/src/database/db.py", line 264, in get_db
    _pool = await asyncpg.create_pool(
            ^^^^^^^^^^^^^^^^^^^^^^^^^^
    ...<4 lines>...
    )
    ^
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/pool.py", line 439, in _async__init__
    await self._initialize()
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/pool.py", line 466, in _initialize
    await first_ch.connect()
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/pool.py", line 153, in connect
    self._con = await self._pool._get_new_connection()
                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/pool.py", line 538, in _get_new_connection
    con = await self._connect(
          ^^^^^^^^^^^^^^^^^^^^
    ...<5 lines>...
    )
    ^
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/connection.py", line 2443, in connect
    return await connect_utils._connect(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    ...<22 lines>...
    )
    ^
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/connect_utils.py", line 1249, in _connect
    raise last_error or exceptions.TargetServerAttributeNotMatched(
    ...<2 lines>...
    )
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/connect_utils.py", line 1218, in _connect
    conn = await _connect_addr(
           ^^^^^^^^^^^^^^^^^^^^
    ...<6 lines>...
    )
    ^
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/connect_utils.py", line 1050, in _connect_addr
    return await __connect_addr(params, False, *args)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/connect_utils.py", line 1099, in __connect_addr
    tr, pr = await connector
             ^^^^^^^^^^^^^^^
  File "/opt/render/project/src/.venv/lib/python3.13/site-packages/asyncpg/connect_utils.py", line 985, in _create_ssl_connection
    new_tr = await loop.start_tls(
             ^^^^^^^^^^^^^^^^^^^^^
        tr, pr, ssl_context, server_hostname=host)
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/render/project/python/Python-3.13.4/lib/python3.13/asyncio/base_events.py", line 1348, in start_tls
    await waiter
  File "/opt/render/project/python/Python-3.13.4/lib/python3.13/asyncio/sslproto.py", line 581, in _on_handshake_complete
    raise handshake_exc
  File "/opt/render/project/python/Python-3.13.4/lib/python3.13/asyncio/sslproto.py", line 563, in _do_handshake
    self._sslobj.do_handshake()
    ~~~~~~~~~~~~~~~~~~~~~~~~~^^
  File "/opt/render/project/python/Python-3.13.4/lib/python3.13/ssl.py", line 951, in do_handshake
    self._sslobj.do_handshake()
    ~~~~~~~~~~~~~~~~~~~~~~~~~^^
ssl.SSLCertVerificationError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate in certificate chain (_ssl.c:1028)
==> Exited with status 1
==> Common ways to troubleshoot your deploy: https://render.com/docs/troubleshooting-deploys
==> Running 'python bot.py'
==> No open ports detected, continuing to scan...
Menu
==> Docs on specifying a port: https://render.com/docs/web-services#port-binding

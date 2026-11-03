  fetch:
    needs: discover
    runs-on: ubuntu-latest
    timeout-minutes: 12
    strategy:
      fail-fast: false
      matrix:
        worker: [0, 1, 2, 3]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Download manifest
        uses: actions/download-artifact@v4
        with:
          name: manifest
          path: data/

      - name: Fetch shard
        working-directory: ${{ github.workspace }}
        timeout-minutes: 8
        env:
          WORKER_ID: ${{ matrix.worker }}
          FETCH_CONCURRENCY: 2
          FETCH_BUDGET_MS: 240000
          REQUEST_TIMEOUT_MS: 20000
          REQUEST_GAP_MS: 150
          BREAKER_LIMIT: 25
          MAX_RETRIES: 2
        run: node scripts/fetch.mjs

      - name: Upload shard
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: shard-${{ matrix.worker }}
          path: data/races-${{ matrix.worker }}.json
          if-no-files-found: warn
          retention-days: 1

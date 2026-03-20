(define-constant TOKEN-STX u0)
(define-constant TOKEN-USDCX u1)
(define-constant RESET-BLOCKS u144)

(define-constant ERR-NOT-OWNER u100)
(define-constant ERR-NOT-AUTHORIZED-AGENT u101)
(define-constant ERR-VAULT-PAUSED u102)
(define-constant ERR-RECIPIENT-NOT-ALLOWED u103)
(define-constant ERR-DUPLICATE-PAYMENT-TXID u104)
(define-constant ERR-INVALID-TOKEN u105)

(define-data-var owner principal tx-sender)
(define-data-var authorized-agent principal tx-sender)
(define-data-var paused bool false)

(define-map token-state
  { token: uint }
  {
    daily-cap: uint,
    spent-in-day: uint,
    last-reset-block: uint
  }
)

(define-map recipient-whitelist
  { recipient: principal }
  { allowed: bool }
)

(define-map recorded-payments
  { payment-txid: (buff 32) }
  { seen: bool }
)

(define-private (default-token-state)
  {
    daily-cap: u0,
    spent-in-day: u0,
    last-reset-block: block-height
  })

(define-private (is-valid-token (token uint))
  (or (is-eq token TOKEN-STX) (is-eq token TOKEN-USDCX)))

(define-private (ensure-token-state (token uint))
  (match (map-get? token-state { token: token })
    state state
    (default-token-state)))

(define-private (compute-refreshed-state (state { daily-cap: uint, spent-in-day: uint, last-reset-block: uint }))
  (let
    (
      (last-reset (get last-reset-block state))
      (should-reset (>= (- block-height last-reset) RESET-BLOCKS))
    )
    (if should-reset
      {
        daily-cap: (get daily-cap state),
        spent-in-day: u0,
        last-reset-block: block-height
      }
      state)))

(define-private (refresh-token-state (token uint))
  (let
    (
      (state (ensure-token-state token))
      (next-state (compute-refreshed-state state))
    )
    (begin
      (map-set token-state { token: token } next-state)
      next-state)))

(define-read-only (get-token-state (token uint))
  (begin
    (asserts! (is-valid-token token) (err ERR-INVALID-TOKEN))
    (ok (compute-refreshed-state (ensure-token-state token)))))

(define-read-only (get-remaining-allowance (token uint))
  (begin
    (asserts! (is-valid-token token) (err ERR-INVALID-TOKEN))
    (let
      (
        (state (compute-refreshed-state (ensure-token-state token)))
        (cap (get daily-cap state))
        (spent (get spent-in-day state))
      )
      (ok (if (> cap spent) (- cap spent) u0)))))

(define-read-only (get-reset-at-block (token uint))
  (begin
    (asserts! (is-valid-token token) (err ERR-INVALID-TOKEN))
    (let
      (
        (state (compute-refreshed-state (ensure-token-state token)))
        (last-reset (get last-reset-block state))
      )
      (ok (+ last-reset RESET-BLOCKS)))))

(define-read-only (is-paused)
  (ok (var-get paused)))

(define-read-only (is-recipient-whitelisted (recipient principal))
  (ok (default-to false (get allowed (map-get? recipient-whitelist { recipient: recipient })))))

(define-public (set-authorized-agent (agent principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) (err ERR-NOT-OWNER))
    (ok (var-set authorized-agent agent))))

(define-public (set-paused (next bool))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) (err ERR-NOT-OWNER))
    (ok (var-set paused next))))

(define-public (set-daily-cap (token uint) (cap uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) (err ERR-NOT-OWNER))
    (asserts! (is-valid-token token) (err ERR-INVALID-TOKEN))
    (let ((state (refresh-token-state token)))
      (ok (map-set token-state
        { token: token }
        {
          daily-cap: cap,
          spent-in-day: (get spent-in-day state),
          last-reset-block: (get last-reset-block state)
        })))))

(define-public (set-recipient-whitelist (recipient principal) (allowed bool))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) (err ERR-NOT-OWNER))
    (ok (map-set recipient-whitelist { recipient: recipient } { allowed: allowed }))))

(define-public (record-spend (token uint) (amount uint) (recipient principal)
                             (payment-txid (buff 32)) (reasoning-hash (buff 32)))
  (begin
    (asserts! (is-eq tx-sender (var-get authorized-agent)) (err ERR-NOT-AUTHORIZED-AGENT))
    (asserts! (not (var-get paused)) (err ERR-VAULT-PAUSED))
    (asserts! (is-valid-token token) (err ERR-INVALID-TOKEN))
    (let
      (
        (state (refresh-token-state token))
        (already-seen (is-some (map-get? recorded-payments { payment-txid: payment-txid })))
        (whitelisted (default-to false (get allowed (map-get? recipient-whitelist { recipient: recipient }))))
      )
      (begin
        (asserts! whitelisted (err ERR-RECIPIENT-NOT-ALLOWED))
        (asserts! (not already-seen) (err ERR-DUPLICATE-PAYMENT-TXID))
        (map-set token-state
          { token: token }
          {
            daily-cap: (get daily-cap state),
            spent-in-day: (+ (get spent-in-day state) amount),
            last-reset-block: (get last-reset-block state)
          })
        (map-set recorded-payments { payment-txid: payment-txid } { seen: true })
        (print
          {
            event: "record-spend",
            token: token,
            amount: amount,
            recipient: recipient,
            payment-txid: payment-txid,
            reasoning-hash: reasoning-hash,
            agent: tx-sender,
            block: block-height
          })
        (ok true)))))

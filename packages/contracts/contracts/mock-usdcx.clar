;; Mock USDCx Token Contract
;; SIP-010-style token used for local and testnet SAT-FLOW demos.
;; This is not real bridged USDCx.

(define-fungible-token usdcx)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-OWNER-ONLY (err u100))
(define-constant ERR-NOT-TOKEN-OWNER (err u101))
(define-constant ERR-FAUCET-LIMIT (err u102))

(define-data-var token-uri (optional (string-utf8 256)) none)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) ERR-NOT-TOKEN-OWNER)
    (try! (ft-transfer? usdcx amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

(define-read-only (get-name)
  (ok "Mock USDCx"))

(define-read-only (get-symbol)
  (ok "mUSDCx"))

(define-read-only (get-decimals)
  (ok u6))

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance usdcx who)))

(define-read-only (get-total-supply)
  (ok (ft-get-supply usdcx)))

(define-read-only (get-token-uri)
  (ok (var-get token-uri)))

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (ft-mint? usdcx amount recipient)))

(define-public (faucet (amount uint))
  (begin
    (asserts! (<= amount u10000000000) ERR-FAUCET-LIMIT)
    (ft-mint? usdcx amount tx-sender)))

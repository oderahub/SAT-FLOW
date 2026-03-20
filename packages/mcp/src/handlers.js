export function createMcpHandlers(client) {
  return {
    async check_allowance(input) {
      return client.checkAllowance(input);
    },
    async pay_bill(input) {
      return client.payBill({
        amount: input.amount,
        recipient: input.recipient,
        justification: input.justification,
        x402Challenge: input.x402_challenge,
      });
    },
  };
}

# Completed Revenue Fix v12

The Admin Completed Orders header previously summed every completed order, including orders marked Free.
Financial Records correctly excluded Free and $0 orders, creating a mismatch.

v12 uses a shared revenue eligibility rule:
- Completed + non-Free + total > $0 => counts as revenue
- Free or $0 completed order => remains visible in Completed Orders but contributes $0 to revenue totals

Updated:
- Completed Orders header total
- The Numbers / earnings report
- Per-inventory completed revenue calculations

Completed-order counts/operational history are still preserved, including free orders.

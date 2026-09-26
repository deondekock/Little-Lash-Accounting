-- Leave requests from staff: 'requested' until approved or declined. Empty = approved (booked by the owner).
ALTER TABLE leave ADD COLUMN status TEXT;

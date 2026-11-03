import { describe, expect, test } from "vitest";
import { dayIndex, joinIndexFromRealDate } from "../lib/companyCalendar";
import {
  computeSchedule,
  finalKey,
  isValidRevisionStart,
  paydayKey,
  revisionStarts,
  type AttendanceStatus,
  type EngineInput,
  type Terms,
} from "../lib/payroll";

const STAFF = "s1";

function input(overrides: Partial<EngineInput> & { terms: Terms[]; joinDate: string }): EngineInput {
  return {
    staffId: STAFF,
    attendance: {},
    adjustments: [],
    payments: [],
    today: "2027-12-01",
    reserveStatus: "held",
    ...overrides,
  };
}

const modeA = (joinDate: string, salary = 30_000): Terms => ({
  effectiveFromIndex: joinIndexFromRealDate(joinDate),
  monthlySalary: salary,
  payMode: "half_16day",
});
const modeB = (joinDate: string, salary = 30_000): Terms => ({
  effectiveFromIndex: joinIndexFromRealDate(joinDate),
  monthlySalary: salary,
  payMode: "monthly_10th",
});

describe("1. join 20 Mar 2027, Mode A", () => {
  const schedule = computeSchedule(input({ joinDate: "2027-03-20", terms: [modeA("2027-03-20")] }));

  test("reserve covers 20–29 Mar and is worth ₹10,000", () => {
    expect(schedule.reserve.startDate).toBe("2027-03-20");
    expect(schedule.reserve.endDate).toBe("2027-03-29");
    expect(schedule.reserve.amount).toBe(10_000);
    expect(schedule.reserve.status).toBe("held");
  });

  test("paydays are 16 Apr, 2 May, 18 May, 4 Jun, each ₹15,000 with full attendance", () => {
    const first = schedule.paydays.slice(0, 4);
    expect(first.map((p) => p.dueDate)).toEqual(["2027-04-16", "2027-05-02", "2027-05-18", "2027-06-04"]);
    expect(first.map((p) => p.net)).toEqual([15_000, 15_000, 15_000, 15_000]);
    expect(first[0].cycleStartDate).toBe("2027-03-30");
    expect(first[0].cycleEndDate).toBe("2027-04-15");
  });

  test("paydayKey is staffId:virtualPaydayIndex", () => {
    expect(schedule.paydays[0].key).toBe(paydayKey(STAFF, dayIndex(2027, 4, 16)));
  });
});

describe("2. two Absent days in the 30 Mar – 15 Apr cycle", () => {
  test("16 Apr pays 15,000 × 14/16 = ₹13,125", () => {
    const attendance: Record<string, AttendanceStatus> = { "2027-04-03": "absent", "2027-04-09": "absent" };
    const schedule = computeSchedule(input({ joinDate: "2027-03-20", terms: [modeA("2027-03-20")], attendance }));
    const april = schedule.paydays[0];
    expect(april.dueDate).toBe("2027-04-16");
    expect(april.tally.paidDays).toBe(14);
    expect(april.net).toBe(13_125);
    expect(april.absentDeduction).toBe(1_875);
    expect(schedule.paydays[1].net).toBe(15_000);
  });

  test("a half-day counts 0.5 and the 31st is ignored by pay maths", () => {
    const attendance: Record<string, AttendanceStatus> = { "2027-04-05": "half_day", "2027-03-31": "absent" };
    const schedule = computeSchedule(input({ joinDate: "2027-03-20", terms: [modeA("2027-03-20")], attendance }));
    expect(schedule.paydays[0].tally.paidDays).toBe(15.5);
    expect(schedule.paydays[0].net).toBe(Math.round((15_000 * 15.5) / 16));
  });

  test("an unmarked past day counts as Present but is flagged", () => {
    const schedule = computeSchedule(
      input({ joinDate: "2027-03-20", terms: [modeA("2027-03-20")], today: "2027-04-05", attendanceFrom: "2027-04-01" }),
    );
    const april = schedule.paydays[0];
    expect(april.tally.paidDays).toBe(16);
    expect(april.tally.unmarkedDates).toEqual(["2027-04-01", "2027-04-02", "2027-04-03", "2027-04-04"]);
  });
});

describe("3. join 3 Feb 2027 (non-leap), Mode A", () => {
  const schedule = computeSchedule(input({ joinDate: "2027-02-03", terms: [modeA("2027-02-03")] }));

  test("S = 13 Feb; the first payday is virtual 29 Feb, paid on 1 Mar", () => {
    expect(schedule.earningStartIndex).toBe(dayIndex(2027, 2, 13));
    const first = schedule.paydays[0];
    expect(first.paydayIndex).toBe(dayIndex(2027, 2, 29));
    expect(first.dueDate).toBe("2027-03-01");
    expect(first.net).toBe(15_000); // virtual days count as paid
    expect(first.tally.counts.virtual).toBe(0); // the cycle is 13–28 Feb
  });

  test("the next payday is 15 Mar, counted from virtual Feb 29, not Mar 1", () => {
    const second = schedule.paydays[1];
    expect(second.paydayIndex).toBe(dayIndex(2027, 3, 15));
    expect(second.dueDate).toBe("2027-03-15");
    // Its cycle includes the two virtual days, both paid.
    expect(second.tally.counts.virtual).toBe(2);
    expect(second.net).toBe(15_000);
  });
});

describe("4. join 20 Mar 2027, Mode B", () => {
  const schedule = computeSchedule(input({ joinDate: "2027-03-20", terms: [modeB("2027-03-20")] }));

  test("the first cycle is 30 Mar (1 day), paying ₹1,000 on 10 Apr", () => {
    const first = schedule.paydays[0];
    expect(first.cycleStartDate).toBe("2027-03-30");
    expect(first.cycleEndDate).toBe("2027-03-30");
    expect(first.dueDate).toBe("2027-04-10");
    expect(first.net).toBe(1_000);
  });

  test("April pays ₹30,000 on 10 May; February pays in full (virtual days are paid)", () => {
    expect(schedule.paydays[1].dueDate).toBe("2027-05-10");
    expect(schedule.paydays[1].net).toBe(30_000);
    const feb = computeSchedule(input({ joinDate: "2027-01-01", terms: [modeB("2027-01-01")] })).paydays.find(
      (p) => p.cycleStartDate === "2027-02-01",
    )!;
    expect(feb.dueDate).toBe("2027-03-10");
    expect(feb.tally.counts.virtual).toBe(2);
    expect(feb.net).toBe(30_000);
  });
});

describe("5. joining on the 31st", () => {
  test("is treated as the 1st of the next month", () => {
    const schedule = computeSchedule(input({ joinDate: "2027-03-31", terms: [modeA("2027-03-31")] }));
    expect(schedule.joinIndex).toBe(dayIndex(2027, 4, 1));
    expect(schedule.reserve.startDate).toBe("2027-04-01");
    expect(schedule.reserve.endDate).toBe("2027-04-10");
    expect(schedule.paydays[0].cycleStartDate).toBe("2027-04-11");
    expect(schedule.paydays[0].dueDate).toBe("2027-04-27");
  });
});

describe("6. revision to ₹36,000 after the 2 May payday", () => {
  const base = { joinDate: "2027-03-20", terms: [modeA("2027-03-20")], today: "2027-04-20" };

  test("2 May is offered as a valid cycle start; a mid-cycle date is not", () => {
    expect(revisionStarts(base, 3)).toEqual([dayIndex(2027, 5, 2), dayIndex(2027, 5, 18), dayIndex(2027, 6, 4)]);
    expect(isValidRevisionStart(base, dayIndex(2027, 5, 2))).toBe(true);
    expect(isValidRevisionStart(base, dayIndex(2027, 5, 3))).toBe(false);
  });

  test("the 18 May payday pays ₹18,000 and the reserve is unchanged", () => {
    const schedule = computeSchedule(
      input({
        ...base,
        today: "2027-12-01",
        terms: [modeA("2027-03-20"), { effectiveFromIndex: dayIndex(2027, 5, 2), monthlySalary: 36_000, payMode: "half_16day" }],
      }),
    );
    const byDate = Object.fromEntries(schedule.paydays.map((p) => [p.dueDate, p.net]));
    expect(byDate["2027-05-02"]).toBe(15_000);
    expect(byDate["2027-05-18"]).toBe(18_000);
    expect(byDate["2027-06-04"]).toBe(18_000);
    expect(schedule.reserve.amount).toBe(10_000);
  });
});

describe("7. mode switch A → B after the 18 May payday", () => {
  test("the first Mode B cycle runs 18–30 May (pro-rated), paid 10 Jun", () => {
    const base = { joinDate: "2027-03-20", terms: [modeA("2027-03-20")], today: "2027-05-05" };
    expect(isValidRevisionStart(base, dayIndex(2027, 5, 18))).toBe(true);
    const schedule = computeSchedule(
      input({
        joinDate: "2027-03-20",
        terms: [modeA("2027-03-20"), { effectiveFromIndex: dayIndex(2027, 5, 18), monthlySalary: 30_000, payMode: "monthly_10th" }],
      }),
    );
    const rows = schedule.paydays.slice(0, 5).map((p) => [p.cycleStartDate, p.cycleEndDate, p.dueDate, p.net]);
    expect(rows).toEqual([
      ["2027-03-30", "2027-04-15", "2027-04-16", 15_000],
      ["2027-04-16", "2027-05-01", "2027-05-02", 15_000],
      ["2027-05-02", "2027-05-17", "2027-05-18", 15_000],
      ["2027-05-18", "2027-05-30", "2027-06-10", 13_000],
      ["2027-06-01", "2027-06-30", "2027-07-10", 30_000],
    ]);
  });

  test("B → A: 16-day paydays from the 1st of the month; the last monthly cycle still pays on the 10th", () => {
    const schedule = computeSchedule(
      input({
        joinDate: "2027-03-20",
        terms: [modeB("2027-03-20"), { effectiveFromIndex: dayIndex(2027, 6, 1), monthlySalary: 30_000, payMode: "half_16day" }],
      }),
    );
    const dates = schedule.paydays.slice(0, 5).map((p) => [p.dueDate, p.net]);
    expect(dates).toEqual([
      ["2027-04-10", 1_000],
      ["2027-05-10", 30_000],
      ["2027-06-10", 30_000],
      ["2027-06-17", 15_000],
      ["2027-07-03", 15_000],
    ]);
  });
});

describe("8. exit mid-cycle", () => {
  const terms = [modeA("2027-03-20")];
  const april = paydayKey(STAFF, dayIndex(2027, 4, 16));
  const exitInput = input({
    joinDate: "2027-03-20",
    terms,
    today: "2027-05-11",
    lastWorkingDay: "2027-05-10",
    payments: [{ id: "p1", paydayKey: april, amount: 15_000, paidOn: "2027-04-16", mode: "cash" }],
  });

  test("pro-rated final cycle + pending + reserve", () => {
    const schedule = computeSchedule(exitInput);
    expect(schedule.paydays.map((p) => p.dueDate)).toEqual(["2027-04-16", "2027-05-02", "2027-05-11"]);
    const final = schedule.paydays.at(-1)!;
    expect(final.isFinal).toBe(true);
    expect(final.cycleStartDate).toBe("2027-05-02");
    expect(final.cycleEndDate).toBe("2027-05-10");
    expect(final.earning).toBe((15_000 * 9) / 16); // 8,437.5
    expect(final.net).toBe(8_438);
    const s = schedule.settlement!;
    expect(s.reserveAmount).toBe(10_000);
    expect(s.paydaysOutstanding).toBe(15_000 + 8_438);
    expect(s.totalOutstanding).toBe(15_000 + 8_438 + 10_000);
    expect(s.key).toBe(finalKey(STAFF));
  });

  test("forfeiting removes the reserve", () => {
    const schedule = computeSchedule({ ...exitInput, reserveStatus: "forfeited" });
    expect(schedule.settlement!.reserveAmount).toBe(0);
    expect(schedule.settlement!.totalOutstanding).toBe(15_000 + 8_438);
  });

  test("a Mode B leaver's last monthly payday falls due with the settlement", () => {
    const schedule = computeSchedule(
      input({ joinDate: "2027-03-20", terms: [modeB("2027-03-20")], today: "2027-05-06", lastWorkingDay: "2027-05-05" }),
    );
    expect(schedule.paydays.map((p) => [p.dueDate, p.net])).toEqual([
      ["2027-04-10", 1_000],
      ["2027-05-06", 30_000], // April's pay, normally due 10 May
      ["2027-05-06", 5_000], // 1–5 May
    ]);
    expect(schedule.settlement!.totalOutstanding).toBe(1_000 + 30_000 + 5_000 + 10_000);
  });

  test("absences in the reserve block reduce it", () => {
    const schedule = computeSchedule({ ...exitInput, attendance: { "2027-03-22": "absent", "2027-03-23": "half_day" } });
    expect(schedule.reserve.amount).toBe(Math.round((30_000 * 8.5) / 30));
  });
});

describe("9. adjustments and partial payments", () => {
  const next = paydayKey(STAFF, dayIndex(2027, 4, 16));
  const adjustments = [
    { id: "a1", type: "advance" as const, amount: 2_000, paydayKey: next, note: "Festival advance", date: "2027-04-05" },
    { id: "a2", type: "bonus" as const, amount: 500, paydayKey: next, note: "Good work", date: "2027-04-06" },
  ];

  test("a ₹2,000 advance and a ₹500 bonus change the next payday's net payable", () => {
    const schedule = computeSchedule(
      input({ joinDate: "2027-03-20", terms: [modeA("2027-03-20")], today: "2027-04-10", adjustments }),
    );
    expect(schedule.next!.key).toBe(next);
    expect(schedule.next!.net).toBe(15_000 + 500 - 2_000);
    expect(schedule.next!.status).toBe("upcoming");
    expect(schedule.pending).toBe(0);
  });

  test("a partial payment leaves the remainder pending", () => {
    const schedule = computeSchedule(
      input({
        joinDate: "2027-03-20",
        terms: [modeA("2027-03-20")],
        today: "2027-04-16",
        adjustments,
        payments: [{ id: "p1", paydayKey: next, amount: 10_000, paidOn: "2027-04-16", mode: "upi" }],
      }),
    );
    const payday = schedule.paydays[0];
    expect(payday.status).toBe("partially_paid");
    expect(payday.outstanding).toBe(3_500);
    expect(schedule.pending).toBe(3_500);
    expect(schedule.next!.dueDate).toBe("2027-05-02");
  });

  test("statuses: due once the date arrives, paid when settled", () => {
    const due = computeSchedule(input({ joinDate: "2027-03-20", terms: [modeA("2027-03-20")], today: "2027-04-16" }));
    expect(due.paydays[0].status).toBe("due");
    expect(due.pending).toBe(15_000);
    const paid = computeSchedule(
      input({
        joinDate: "2027-03-20",
        terms: [modeA("2027-03-20")],
        today: "2027-04-17",
        payments: [{ id: "p", paydayKey: next, amount: 15_000, paidOn: "2027-04-16", mode: "bank" }],
      }),
    );
    expect(paid.paydays[0].status).toBe("paid");
    expect(paid.pending).toBe(0);
  });

  test("by default a schedule lists the next 6 paydays after today", () => {
    const schedule = computeSchedule(input({ joinDate: "2027-03-20", terms: [modeA("2027-03-20")], today: "2027-04-20" }));
    expect(schedule.paydays.filter((p) => p.dueDate > "2027-04-20")).toHaveLength(6);
  });
});

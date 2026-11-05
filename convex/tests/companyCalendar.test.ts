import { describe, expect, test } from "vitest";
import {
  addDays,
  dayIndex,
  fromIndex,
  fromRealDate,
  indexOnOrBefore,
  isVirtual,
  joinIndexFromRealDate,
  monthEnd,
  tenthOfNextMonth,
  toRealDate,
} from "../lib/companyCalendar";

describe("company calendar", () => {
  test("dayIndex follows y*360 + (m-1)*30 + (d-1)", () => {
    expect(dayIndex(2027, 1, 1)).toBe(2027 * 360);
    expect(dayIndex(2027, 3, 20)).toBe(2027 * 360 + 60 + 19);
    expect(dayIndex(2027, 12, 30)).toBe(2027 * 360 + 359);
  });

  test("dayIndex rejects the 31st and day 0", () => {
    expect(() => dayIndex(2027, 1, 31)).toThrow();
    expect(() => dayIndex(2027, 1, 0)).toThrow();
    expect(() => dayIndex(2027, 13, 1)).toThrow();
  });

  test("fromIndex is the inverse of dayIndex for every day of a year", () => {
    for (let m = 1; m <= 12; m += 1) {
      for (let d = 1; d <= 30; d += 1) {
        expect(fromIndex(dayIndex(2027, m, d))).toEqual({ y: 2027, m, d });
      }
    }
  });

  test("addDays crosses months on the 30-day calendar", () => {
    expect(fromIndex(addDays(dayIndex(2027, 3, 30), 1))).toEqual({
      y: 2027,
      m: 4,
      d: 1,
    });
    expect(fromIndex(addDays(dayIndex(2027, 12, 30), 1))).toEqual({
      y: 2028,
      m: 1,
      d: 1,
    });
    expect(fromIndex(addDays(dayIndex(2027, 4, 1), -1))).toEqual({
      y: 2027,
      m: 3,
      d: 30,
    });
  });

  test("Feb 29 is virtual in non-leap years only; Feb 30 is always virtual", () => {
    expect(isVirtual(dayIndex(2027, 2, 28))).toBe(false);
    expect(isVirtual(dayIndex(2027, 2, 29))).toBe(true);
    expect(isVirtual(dayIndex(2027, 2, 30))).toBe(true);
    expect(isVirtual(dayIndex(2028, 2, 29))).toBe(false);
    expect(isVirtual(dayIndex(2028, 2, 30))).toBe(true);
    expect(isVirtual(dayIndex(2100, 2, 29))).toBe(true); // not a leap year
    expect(isVirtual(dayIndex(2000, 2, 29))).toBe(false);
  });

  test("toRealDate rolls virtual days forward to Mar 1", () => {
    expect(toRealDate(dayIndex(2027, 2, 29))).toBe("2027-03-01");
    expect(toRealDate(dayIndex(2027, 2, 30))).toBe("2027-03-01");
    expect(toRealDate(dayIndex(2028, 2, 29))).toBe("2028-02-29");
    expect(toRealDate(dayIndex(2028, 2, 30))).toBe("2028-03-01");
    expect(toRealDate(dayIndex(2027, 3, 20))).toBe("2027-03-20");
  });

  test("fromRealDate returns null for the 31st", () => {
    expect(fromRealDate("2027-03-31")).toBeNull();
    expect(fromRealDate("2027-03-30")).toBe(dayIndex(2027, 3, 30));
    expect(fromRealDate("2028-02-29")).toBe(dayIndex(2028, 2, 29));
    expect(() => fromRealDate("2027-02-29")).toThrow(); // not a real date
  });

  test("a joining date on the 31st is the 1st of the next month", () => {
    expect(joinIndexFromRealDate("2027-03-31")).toBe(dayIndex(2027, 4, 1));
    expect(joinIndexFromRealDate("2027-12-31")).toBe(dayIndex(2028, 1, 1));
    expect(joinIndexFromRealDate("2027-03-30")).toBe(dayIndex(2027, 3, 30));
  });

  test("helpers: today on a 31st, month end, 10th of next month", () => {
    expect(indexOnOrBefore("2027-03-31")).toBe(dayIndex(2027, 3, 30));
    expect(monthEnd(dayIndex(2027, 2, 13))).toBe(dayIndex(2027, 2, 30));
    expect(tenthOfNextMonth(dayIndex(2027, 12, 5))).toBe(dayIndex(2028, 1, 10));
  });
});

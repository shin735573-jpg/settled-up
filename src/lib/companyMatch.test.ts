import { describe, it, expect } from "vitest";
import { matchesCompany, normCompanyName } from "./companyMatch";

const A = { id: "id-a", name: "모던" };
const B = { id: "id-b", name: "리빙" };

describe("normCompanyName", () => {
  it("공백/대소문자 무시", () => {
    expect(normCompanyName(" Modern ")).toBe("modern");
    expect(normCompanyName("모  던")).toBe("모던");
    expect(normCompanyName(null)).toBe("");
    expect(normCompanyName(undefined)).toBe("");
  });
});

describe("matchesCompany - company_id 우선", () => {
  it("id 일치 시 true", () => {
    expect(matchesCompany({ company_id: "id-a", company_name: "리빙" }, A)).toBe(true);
  });
  it("id 불일치 시 false (이름이 같아도 무시)", () => {
    expect(matchesCompany({ company_id: "id-b", company_name: "모던" }, A)).toBe(false);
  });
});

describe("matchesCompany - company_id null 폴백", () => {
  it("이름 정확 일치 시 true", () => {
    expect(matchesCompany({ company_id: null, company_name: "모던" }, A)).toBe(true);
  });
  it("앞뒤 공백 허용", () => {
    expect(matchesCompany({ company_id: null, company_name: "  모던 " }, A)).toBe(true);
  });
  it("대소문자 무시", () => {
    expect(matchesCompany({ company_id: null, company_name: "MODERN" }, { id: "x", name: "modern" })).toBe(true);
  });
  it("다른 업체 이름은 false (섞임 방지)", () => {
    expect(matchesCompany({ company_id: null, company_name: "리빙" }, A)).toBe(false);
  });
  it("company_name이 null이면 false", () => {
    expect(matchesCompany({ company_id: null, company_name: null }, A)).toBe(false);
  });
  it("company_name이 빈 문자열이면 false", () => {
    expect(matchesCompany({ company_id: null, company_name: "" }, A)).toBe(false);
  });
  it("업체 이름이 비어 있으면 false (빈값끼리 매칭 방지)", () => {
    expect(matchesCompany({ company_id: null, company_name: "" }, { id: "x", name: "" })).toBe(false);
  });
  it("두 업체 중 한 업체에만 매칭 — 섞이지 않음", () => {
    const row = { company_id: null, company_name: "모던" };
    expect(matchesCompany(row, A)).toBe(true);
    expect(matchesCompany(row, B)).toBe(false);
  });
});
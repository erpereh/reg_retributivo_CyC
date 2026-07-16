import { describe, expect, it } from "vitest";
import { validateCitedAnswer } from "@/lib/assistant/citations/validator";

describe("structured assistant citations", () => {
  it("maps allowed opaque references to visible numbers and associates only used sources", () => {
    const result = validateCitedAnswer(
      "El Registro suma 63.862,04 € [[source:source-reg]], los recibos 64,070.09 € [[source:source-pdf]] y la diferencia es 208,05 € [[source:source-diff]].",
      {
        allowedSourceIds: ["source-reg", "source-pdf", "source-diff", "source-unused"],
        verifiedAmounts: [63862.04, 64070.09, 208.05],
        verifiedEmployeeIds: ["10048"],
      },
    );
    expect(result.text).toBe("El Registro suma 63.862,04 € [1], los recibos 64,070.09 € [2] y la diferencia es 208,05 € [3].");
    expect(result.usedSourceIds).toEqual(["source-reg", "source-pdf", "source-diff"]);
  });

  it("rejects nonexistent citations, invented monetary amounts and employee ids", () => {
    expect(() => validateCitedAnswer("Total 10,00 € [[source:invented]].", { allowedSourceIds: ["source-1"], verifiedAmounts: [10], verifiedEmployeeIds: [] })).toThrow("citation_not_allowed");
    expect(() => validateCitedAnswer("Total 11,00 € [[source:source-1]].", { allowedSourceIds: ["source-1"], verifiedAmounts: [10], verifiedEmployeeIds: [] })).toThrow("contradictory_amount");
    expect(() => validateCitedAnswer("La matrícula 99999 tiene 10,00 € [[source:source-1]].", { allowedSourceIds: ["source-1"], verifiedAmounts: [10], verifiedEmployeeIds: ["10048"] })).toThrow("invented_employee_id");
  });

  it("keeps a correct but incomplete response", () => {
    expect(validateCitedAnswer("La diferencia es 208,05 € [[source:source-diff]].", { allowedSourceIds: ["source-diff"], verifiedAmounts: [63862.04, 64070.09, 208.05], verifiedEmployeeIds: ["10048"] })).toEqual({ text: "La diferencia es 208,05 € [1].", usedSourceIds: ["source-diff"] });
  });
});

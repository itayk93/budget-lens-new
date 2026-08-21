import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EditCategoryTargetSheet from "./EditCategoryTargetSheet";

describe("EditCategoryTargetSheet", () => {
  it("copies Riseup's automatic/personal choice and saves the selected amount", () => {
    const onSave = vi.fn();
    render(
      <EditCategoryTargetSheet
        categoryName="פארמה"
        month="2026-07"
        current={280}
        spent={279.4}
        suggestion={173}
        history={[
          { label: "יולי", amount: 279 },
          { label: "יוני", amount: 314 },
          { label: "מאי", amount: 81 },
          { label: "אפר׳", amount: 123 },
          { label: "מרץ", amount: 213 },
        ]}
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("כמה כסף צפוי לצאת על פארמה ביולי?")).toBeInTheDocument();
    expect(screen.getByDisplayValue("280")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("region", { name: "צפי אוטומטי לפי העבר" }));
    expect(screen.getByDisplayValue("173")).toBeInTheDocument();

    fireEvent.click(screen.getByText("צפי שלי"));
    fireEvent.change(screen.getByDisplayValue("173"), { target: { value: "280" } });
    fireEvent.click(screen.getByRole("button", { name: "עדכון" }));
    expect(onSave).toHaveBeenCalledWith(280);
  });
});

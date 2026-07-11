import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormMessage, useFormField } from "./form";

function IdsProbe() {
  const field = useFormField();
  return (
    <div
      data-testid="probe"
      data-field-id={field.id}
      data-name={field.name}
      data-form-item-id={field.formItemId}
      data-form-description-id={field.formDescriptionId}
      data-form-message-id={field.formMessageId}
    />
  );
}

describe("useFormField", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws a clear error when rendered inside <Form> but outside <FormField> (regression guard for C402)", () => {
    // React logs the thrown render error to console.error; that's expected
    // noise from intentionally crashing the tree, not a real failure.
    vi.spyOn(console, "error").mockImplementation(() => {});

    function Harness() {
      const form = useForm({ defaultValues: { test: "" } });
      return (
        <Form {...form}>
          <IdsProbe />
        </Form>
      );
    }

    expect(() => render(<Harness />)).toThrow(/useFormField should be used within <FormField>/);
  });

  it("throws a clear error when rendered inside <FormField> but outside <FormItem>", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    function Harness() {
      const form = useForm({ defaultValues: { test: "" } });
      return (
        <Form {...form}>
          <FormField control={form.control} name="test" render={() => <IdsProbe />} />
        </Form>
      );
    }

    expect(() => render(<Harness />)).toThrow(/useFormField should be used within <FormItem>/);
  });

  it("returns the field name and derived ids when properly nested inside FormField > FormItem", () => {
    function Harness() {
      const form = useForm({ defaultValues: { test: "" } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="test"
            render={() => (
              <FormItem>
                <IdsProbe />
              </FormItem>
            )}
          />
        </Form>
      );
    }

    render(<Harness />);

    const probe = screen.getByTestId("probe");
    const id = probe.dataset.fieldId;
    expect(id).toBeTruthy();
    expect(probe.dataset.name).toBe("test");
    expect(probe.dataset.formItemId).toBe(`${id}-form-item`);
    expect(probe.dataset.formDescriptionId).toBe(`${id}-form-item-description`);
    expect(probe.dataset.formMessageId).toBe(`${id}-form-item-message`);
  });

  it("FormLabel resolves htmlFor to the same formItemId useFormField reports", () => {
    function Harness() {
      const form = useForm({ defaultValues: { test: "" } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="test"
            render={() => (
              <FormItem>
                <FormLabel>Test label</FormLabel>
                <IdsProbe />
              </FormItem>
            )}
          />
        </Form>
      );
    }

    render(<Harness />);

    const label = screen.getByText("Test label");
    const probe = screen.getByTestId("probe");
    expect(label.getAttribute("for")).toBe(probe.dataset.formItemId);
  });

  it("FormMessage renders the field's validation error text once the form is validated", async () => {
    function Harness() {
      const form = useForm({
        defaultValues: { test: "" },
        mode: "onChange",
      });

      React.useEffect(() => {
        form.setError("test", { type: "required", message: "This field is required" });
      }, [form]);

      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="test"
            render={() => (
              <FormItem>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      );
    }

    render(<Harness />);

    expect(await screen.findByText("This field is required")).toBeInTheDocument();
  });

  it("FormMessage renders nothing when there is no error and no children", () => {
    function Harness() {
      const form = useForm({ defaultValues: { test: "" } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="test"
            render={() => (
              <FormItem>
                <FormMessage data-testid="message" />
              </FormItem>
            )}
          />
        </Form>
      );
    }

    render(<Harness />);
    expect(screen.queryByTestId("message")).not.toBeInTheDocument();
  });
});

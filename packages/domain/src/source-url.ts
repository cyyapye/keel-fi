import { z } from "zod";

export const HttpsSourceUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" && url.username === "" && url.password === ""
      );
    } catch {
      return false;
    }
  }, "Source URLs must use HTTPS without credentials.");

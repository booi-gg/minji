/** Saves `text` as a file through a temporary link. */
export const downloadText = (fileName: string, text: string, type = "application/json"): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

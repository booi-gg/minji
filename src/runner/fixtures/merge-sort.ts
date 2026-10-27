function mergeSort(nums: number[]): number[] {
  if (nums.length <= 1) return nums;
  const mid = nums.length >> 1;
  const left = mergeSort(nums.slice(0, mid));
  const right = mergeSort(nums.slice(mid));
  const out: number[] = new Array(nums.length);
  let i = 0, j = 0, k = 0;
  while (i < left.length && j < right.length) out[k++] = left[i] <= right[j] ? left[i++] : right[j++];
  while (i < left.length) out[k++] = left[i++];
  while (j < right.length) out[k++] = right[j++];
  return out;
}

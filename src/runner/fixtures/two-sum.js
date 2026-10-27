/**
 * @param {number[]} nums
 * @param {number} target
 * @return {number[]}
 */
var twoSum = function(nums, target) {
  const seen = {};
  for (let i = 0; i < nums.length; i++) {
    const want = target - nums[i];
    if (want in seen) return [seen[want], i];
    seen[nums[i]] = i;
  }
  return [];
};

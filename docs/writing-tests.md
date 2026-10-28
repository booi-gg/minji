# Writing test cases

Open a problem and the **Testcase** tab. Select **+** to add a case, then fill in one JSON field per argument (labeled `name =`) and **Expected =**. Strings need double quotes. Hover a case and select **×** to delete it; **Options** holds its name and advanced settings. **Run all** runs every valid case (Mod+Shift+Enter runs the selected one); invalid cases show an error and are skipped. **Test Result** shows each case's input, stdout, output and expected value.

## Function calls and returned values

Each argument gets its own field, labelled with the parameter name from your code. For `twoSum(nums, target)`, use:

| Field        | Value         |
| ------------ | ------------- |
| `nums =`     | `[2,7,11,15]` |
| `target =`   | `9`           |
| `Expected =` | `[0,1]`       |

A function with no parameters shows no argument fields; for `answer()` returning `42`, just enter Expected `42`. Expected can also be a JSON string, boolean, `null`, array, or object. Object key order does not matter; array order does by default.

Under **Options**, leave **Test type** on **Function call** and **Compare** on **Return value** for these.

## Functions that change an argument

For a function such as `reverse(nums)` that changes the input array and returns nothing, enter `nums =` `[1,2,3]` and Expected `[3,2,1]`, then under **Options** set **Compare** to **Argument 1 (nums) after the call**. Choose the argument the solution changes; **Return value** would compare its `undefined` return instead.

## Linked lists and binary trees

Node adapters are available on **Function call** cases. Enter ordinary JSON arrays, then under **Options** choose an adapter for each argument that the solution expects as nodes. Choose a **Result adapter** when the returned value or compared argument is also a node. The runner supplies `ListNode` and `TreeNode` constructors to solution code.

| Function shape                         | Argument           | Expected         | Adapter settings                                     |
| -------------------------------------- | ------------------ | ---------------- | ---------------------------------------------------- |
| `append(head)` returns a linked list   | `head =` `[1,2,3]` | `[1,2,3,4]`      | Argument 1: **Linked list**; Result: **Linked list** |
| `addRight(root)` returns a binary tree | `root =` `[1,2,3]` | `[1,2,3,null,7]` | Argument 1: **Binary tree**; Result: **Binary tree** |

Lists use values from head to tail. Trees use level order with `null` for missing children, so `[1,null,3]` means the root has no left child and a right child with value `3`. Use `[]` for an empty list or tree. For an in-place node change, select the changed argument under **Compare** and still set its **Result adapter** so the result is converted back to an array.

## Class method sequences

Set the entry point (**More → Entry point**) to the class name and, under **Options**, choose **Class method sequence** as the test type. The case then shows one raw **Calls** field. For `class Counter` with `constructor(start)`, `add(amount)`, and `get()`, enter:

| Field    | Value                                                       |
| -------- | ----------------------------------------------------------- |
| Calls    | `[["Counter","add","get","add","get"],[[2],[3],[],[4],[]]]` |
| Expected | `[null,null,5,null,9]`                                      |

The first array lists the constructor and method names. The second array gives each call's arguments in the same order. The constructor's result is always `null`; methods that return `undefined` also appear as `null`. Each test case creates a fresh instance. Class cases compare the whole result sequence and do not use node adapters.

## Comparison options for each case

- **Ignore outer array order** accepts a permutation of the Expected array, including duplicate values. Nested arrays still compare in order. For example, Expected `[1,1,2]` accepts `[2,1,1]` but not `[2,2,1]`.
- **Numeric tolerance (absolute)** accepts numeric differences up to the entered amount, including numbers inside arrays and objects. For example, Expected `3.14` accepts `3.141` with tolerance `0.01`. Leave it blank for exact comparison.
- Both options can be used together. They apply only to the case where you set them.

Expected values that JSON cannot express directly can use `{"$minji":"undefined"}`, `{"$minji":"NaN"}`, `{"$minji":"Infinity"}`, `{"$minji":"-Infinity"}`, or `{"$minji":"-0"}`. For example, use `{"$minji":"undefined"}` when a function intentionally returns `undefined`. Argument fields remain ordinary JSON. See [test case rules](../specs/test-cases.md) for validation, comparison, and result details.

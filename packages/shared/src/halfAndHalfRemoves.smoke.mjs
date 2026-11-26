import {
  halfAndHalfWizardStepForGroup,
  isHalfAndHalfRemoveGroup,
  isPizzaRemoveToppingGroup,
} from "../dist/pizzaHalfAndHalfWizard.js";

const removeNames = [
  "Remove Toppings",
  '12" Remove Toppings',
  '9" Remove Toppings',
  "No Cheese",
];

for (const name of removeNames) {
  if (!isPizzaRemoveToppingGroup(name)) {
    console.error("FAIL: expected remove group", name);
    process.exit(1);
  }
  if (halfAndHalfWizardStepForGroup(name) !== "removes") {
    console.error("FAIL: wizard step should be removes for", name);
    process.exit(1);
  }
}

const notRemove = ['12" Right Half & Half Pizza', '12" Left Half & Half Extras'];
for (const name of notRemove) {
  if (isHalfAndHalfRemoveGroup(name)) {
    console.error("FAIL: should not classify as remove", name);
    process.exit(1);
  }
}

console.log("ok half-and-half removes");
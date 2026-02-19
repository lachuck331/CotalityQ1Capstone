document.getElementById("clickMeBtn").addEventListener("click", function () {
  const message = document.getElementById("message");
  if (message.innerHTML === "") {
    message.innerHTML = "You clicked the button!";
  } else {
    message.innerHTML = "";
  }
});

console.log("Website loaded successfully!");

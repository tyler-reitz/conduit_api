const router = require("express").Router();
const mongoose = require("mongoose");
const Article = mongoose.model("Article");

router.get("/", (req, res, next) => {
  Article.find()
    .distinct("tagList")
    .then(tags => res.json({ tags: tags }))
    .catch(next);
});

module.exports = router;

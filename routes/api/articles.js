const router = require("express").Router();
const passport = require("passport");
const mongoose = require("mongoose");
const Article = mongoose.model("Article");
const User = mongoose.model("User");
const Comment = mongoose.model('Comment')
const auth = require("../auth");

router.param("article", function(req, res, next, slug) {
  Article.findOne({ slug: slug })
    .populate("author")
    .then(function(article) {
      if (!article) {
        return res.sendStatus(404);
      }
      req.article = article;
      return next();
    })
    .catch(next);
});

router.get('/', auth.optional, (req, res, next) => {
  let query = {}
  let limit = 20
  let offset = 0

  if (typeof req.query.limit !== 'undefined') {
    limit = req.query.limit
  }

  if (typeof req.query.offset !== 'undefined') {
    offset = req.query.offset
  }

  if (typeof req.query.tag !== 'undefined') {
    query.tagList = { '$in': [req.query.tag] }
  }

  Promise.all([
    req.query.author ? User.findOne({ username: req.query.author  }) : null,
    req.query.favorited ? User.findOne({ username: req.query.favorited  }) : null
  ]).then(results => {
    const [ author, favoriter  ] = results

    if (author) {
      query.author = author._id
    }

    if (favoriter) {
      query._id = {$in: favoriter.favorites }
    } else if (req.query.favorited) {
      query._id = {$in: []}
    }

    return Promise.all([
      Article.find(query)
        .limit(Number(limit))
        .skip(Number(offset))
        .sort({ createdAt: 'desc' })
        .populate('author')
        .exec(),
      Article.count(query).exec(),
      req.payload ? User.findById(req.payload.id) : null
    ]).then(results => {
      const [ articles, articlesCount, user ] = results

      res.json({
        articles: articles.map(article => article.toJSONFor(user) ),
        articlesCount
      })
    })
  }).catch(next)

})

router.post("/", auth.required, function(req, res, next) {
  User.findById(req.payload.id)
    .then(function(user) {
      if (!user) {
        return res.sendStatus(401);
      }

      const article = new Article(req.body.article);

      article.author = user;

      return article.save().then(function() {
        return res.json({ article: article.toJSONFor(user) });
      });
    })
    .catch(next);
});


router.get('/feed', auth.required, (req, res, next) => {
  let limit = 20
  let offset = 0

  if (typeof req.query.limit !== 'undefined') {
    limit = req.query.limit
  }

  if (typeof req.query.offset !== 'undefined') {
    offset = req.query.offset
  }

  User.findById(req.payload.id).then(user => {
    if (!user) { return res.sendStatus(401) }

    Promise.all([
      Article.find({ author: { $in: user.following} })
        .limit(Number(limit))
        .skip(Number(offset))
        .populate('author')
        .exec(),
      Article.count({ author: { $in: user.following } })
    ]).then(results => {
      const [ articles, articlesCount ] = results

      return res.json({
        articles: articles.map(article => article.toJSONFor(user)),
        articlesCount
      })
    })
  }).catch(next)
})


router.get("/:article", auth.optional, function(req, res, next) {
  Promise.all([
    req.payload ? User.findById(req.payload.id) : null,
    req.article.populate("author").execPopulate()
  ])
    .then(function(results) {
      const user = results[0];
      return res.json({ article: req.article.toJSONFor(user) });
    })
    .catch(next);
});

router.put("/:article", auth.required, (req, res, next) => {
  User.findById(req.payload.id).then(user => {
    if (req.article.author._id.toString() === req.payload.id.toString()) {
      if (typeof req.body.article.title !== "undefined") {
        req.article.title = req.body.article.title;
      }
      if (typeof req.body.article.description !== "undefined") {
        req.article.description = req.body.article.description;
      }
      if (typeof req.body.article.body !== "undefined") {
        req.article.body = req.body.article.body;
      }
      req.article
        .save()
        .then(article => res.json({ articles: article.toJSONFor(user) }))
        .catch(next);
    } else {
      return res.sendStatus(403);
    }
  });
});

router.delete("/:article", auth.required, (req, res, next) => {
  User.findById(req.payload.id).then(() => {
    if (req.article.author._id.toString() === req.payload.id.toString()) {
      return req.article.remove().then(() => {
        return res.sendStatus(204);
      });
    } else {
      return res.sendStatus(403);
    }
  });
});

router.post("/:article/favorite", auth.required, (req, res, next) => {
  const articleId = req.article._id;

  User.findById(req.payload.id)
    .then(user => {
      if (!user) {
        return res.sendStatus(401);
      }

      return user.favorite(articleId).then(() => {
        return req.article.updateFavoritesCount().then(article => {
          return res.json({ articles: article.toJSONFor(user) });
        });
      });
    })
    .catch(next);
});

router.delete("/:article/favorite", auth.required, (req, res, next) => {
  const articleId = req.article._id;

  User.findById(req.payload.id)
    .then(user => {
      if (!user) {
        return res.sendStatus(401);
      }

      return user.unfavorite(articleId).then(() => {
        return req.article.updateFavoritesCount().then(article => {
          return res.json({ article: article.toJSONFor(user) });
        });
      });
    })
    .catch(next);
});

router.post("/:article/comments", auth.required, (req, res, next) => {
  User.findById(req.payload.id)
    .then(user => {
      if (!user) {
        res.sendStatus(401);
      }

      const comment = new Comment(req.body.comment);
      comment.article = req.article;
      comment.author = user;

      return comment.save().then(() => {
        req.article.comments.push(comment);

        return req.article.save().then(article => {
          res.json({ comments: comment.toJSONFor(user) });
        });
      });
    })
    .catch(next);
});

router.get("/:article/comments", auth.optional, (req, res, next) => {
  Promise.resolve(req.payload ? User.findById(req.payload.id) : null)
    .then(user => {
      return req.article
        .populate({
          path: "comments",
          populate: {
            path: "author"
          },
          options: {
            sort: {
              createdAt: "desc"
            }
          }
        })
        .execPopulate()
        .then(article => {
          //console.log(article)
          return res.json({
            comments: req.article.comments.map(comment => 
              comment.toJSONFor(user)
            )
          });
        });
    })
    .catch(next);
});

router.param("comment", (req, res, next, id) => {
  Comment.findById(id)
    .then(comment => {
      if (!comment) {
        return res.sendStatus(404);
      }
      req.comment = comment;
      return next();
    })
    .catch(next);
});

router.delete(
  "/:article/comments/:comment",
  auth.required,
  (req, res, next) => {
    if (req.comment.author.toString() === req.payload.id.toString()) {
      req.article.comments.remove(req.comment._id);
      req.article
        .save()
        .then(Comment.find({ _id: req.comment._id }).remove().exec())
        .then(() => res.sendStatus(204));
    } else {
      res.sendStatus(403);
    }
  }
);

module.exports = router;

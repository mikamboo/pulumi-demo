import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

// Create an S3 bucket configured to serve static website content
const bucket = new aws.s3.Bucket("my-bucket", {
  website: {
    indexDocument: "index.html",
    errorDocument: "error.html",
  },
});

const ownershipControls = new aws.s3.BucketOwnershipControls(
  "ownership-controls",
  {
    bucket: bucket.id,
    rule: {
      objectOwnership: "ObjectWriter",
    },
  }
);

const publicAccessBlock = new aws.s3.BucketPublicAccessBlock(
  "public-access-block",
  {
    bucket: bucket.id,
    blockPublicAcls: false,
  }
);

/**
 * Upload the files for the static website to the S3 bucket
 */
const files = ["index.html", "error.html"];
for (const file of files) {
  new aws.s3.BucketObject(
    file,
    {
      bucket: bucket,
      source: new pulumi.asset.FileAsset(`./www/${file}`),
      contentType: "text/html",
      acl: "public-read",
    },
    { dependsOn: [publicAccessBlock, ownershipControls] }
  );
}

// Update the S3 bucket policy to grant read access to the Origin Access Identity
const bucketPolicy = new aws.s3.BucketPolicy("myBucketPolicy", {
  bucket: bucket.bucket,
  policy: bucket.bucket.apply((bucketName: string) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: {
            Service: "cloudfront.amazonaws.com",
          },
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${bucketName}/*`,
          Condition: {
            StringEquals: {
              "AWS:SourceArn": cdn.arn.apply((arn: string) => arn), //to fix
            },
          },
        },
      ],
    })
  ),
});

// Create a CloudFront distribution for the S3 bucket
const cdn = new aws.cloudfront.Distribution("my-cdn", {
  origins: [
    {
      domainName: bucket.websiteEndpoint,
      originId: bucket.arn,
      customOriginConfig: {
        // Amazon S3 doesn't support HTTPS connections when using an S3 bucket configured as a website endpoint
        originProtocolPolicy: "http-only",
        httpPort: 80,
        httpsPort: 443,
        originSslProtocols: ["TLSv1.2"],
      },
    },
  ],
  enabled: true,
  isIpv6Enabled: true,
  defaultRootObject: "index.html",
  defaultCacheBehavior: {
    targetOriginId: bucket.arn,
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD", "OPTIONS"],
    cachedMethods: ["GET", "HEAD", "OPTIONS"],
    forwardedValues: {
      queryString: false,
      cookies: { forward: "none" },
    },
    minTtl: 0,
    defaultTtl: 3600,
    maxTtl: 86400,
  },
  priceClass: "PriceClass_100", // Choose the price class that best fits your needs
  viewerCertificate: {
    cloudfrontDefaultCertificate: true,
  },
  restrictions: {
    geoRestriction: {
      restrictionType: "none",
    },
  },
  // Use the S3 bucket's website endpoint as the custom error response page path
  customErrorResponses: [
    {
      errorCode: 404,
      responseCode: 404,
      responsePagePath: "/error.html",
    },
  ],
});

export const distributionUrl = cdn.domainName;
export const bucketEndpoint = pulumi.interpolate`http://${bucket.websiteEndpoint}`;
